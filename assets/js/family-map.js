(function () {
  "use strict";

  var DEFAULT_ROUTE_COLOR = "#6b5b4a";
  var DEFAULT_CENTER = [20, 180];
  var DEFAULT_ZOOM = 2;
  var MAP_ELEMENT_ID = "family-map";
  var LEGEND_ELEMENT_ID = "family-map-legend";

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function toRadians(deg) {
    return deg * (Math.PI / 180);
  }

  function normalizeLng(lng) {
    return (((lng % 360) + 360) % 360);
  }

  function shortestLngPath(fromLng, toLng) {
    var adjustedToLng = toLng;
    var delta = adjustedToLng - fromLng;
    if (delta > 180) {
      adjustedToLng -= 360;
    } else if (delta < -180) {
      adjustedToLng += 360;
    }
    return adjustedToLng;
  }

  function haversineKm(a, b) {
    var radiusKm = 6371;
    var lat1 = toRadians(a.lat);
    var lat2 = toRadians(b.lat);
    var dLat = lat2 - lat1;
    var dLng = toRadians(b.lng - a.lng);
    var sinLat = Math.sin(dLat / 2);
    var sinLng = Math.sin(dLng / 2);
    var h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
    return 2 * radiusKm * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getFamilyMapData() {
    var raw = window.FAMILY_MAP_DATA || {};
    var data = {
      people: Array.isArray(raw.people) ? raw.people : [],
      places: Array.isArray(raw.places) ? raw.places : [],
      moves: Array.isArray(raw.moves) ? raw.moves : []
    };

    if (!Array.isArray(raw.people) || !Array.isArray(raw.places) || !Array.isArray(raw.moves)) {
      console.error("[family-map] FAMILY_MAP_DATA is missing expected arrays: people, places, moves.");
    }

    return data;
  }

  function buildPeopleById(people) {
    var peopleById = {};
    people.forEach(function (person) {
      if (!person || person.id === undefined || person.id === null) {
        return;
      }
      var personId = String(person.id).trim();
      if (personId === "") {
        return;
      }
      peopleById[personId] = person;
    });
    return peopleById;
  }

  function buildPlacesById(places) {
    var placesById = {};
    places.forEach(function (place) {
      if (!place || place.id === undefined || place.id === null) {
        return;
      }
      var placeId = String(place.id).trim();
      if (placeId === "") {
        return;
      }
      placesById[placeId] = place;
    });
    return placesById;
  }

  function renderLegend(people) {
    var legendEl = document.getElementById(LEGEND_ELEMENT_ID);
    if (!legendEl) {
      console.warn("[family-map] Legend container not found.");
      return;
    }

    legendEl.innerHTML = "";

    var titleEl = document.createElement("p");
    titleEl.className = "family-legend-title";
    titleEl.textContent = "People";
    legendEl.appendChild(titleEl);

    var listEl = document.createElement("ul");
    listEl.className = "family-legend-list";
    legendEl.appendChild(listEl);

    if (!Array.isArray(people) || people.length === 0) {
      var emptyEl = document.createElement("li");
      emptyEl.className = "family-legend-item";
      emptyEl.textContent = "No people configured";
      listEl.appendChild(emptyEl);
      return;
    }

    people.forEach(function (person) {
      if (!person || typeof person.name !== "string") {
        return;
      }
      var color = typeof person.color === "string" ? person.color : DEFAULT_ROUTE_COLOR;
      var itemEl = document.createElement("li");
      itemEl.className = "family-legend-item";

      var swatchEl = document.createElement("span");
      swatchEl.className = "family-legend-swatch";
      swatchEl.style.backgroundColor = color;
      itemEl.appendChild(swatchEl);

      var nameEl = document.createElement("span");
      nameEl.textContent = person.name;
      itemEl.appendChild(nameEl);

      listEl.appendChild(itemEl);
    });
  }

  function renderPlaces(map, places) {
    var placePoints = [];
    if (!Array.isArray(places)) {
      console.error("[family-map] renderPlaces() expected an array.");
      return placePoints;
    }

    places.forEach(function (place) {
      if (!place || typeof place.id !== "string") {
        console.warn("[family-map] Skipping place with missing id.", place);
        return;
      }

      var lat = Number(place.lat);
      var lng = Number(place.lng);
      if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
        console.warn("[family-map] Skipping place with invalid lat/lng for id:", place.id);
        return;
      }

      var latLng = [lat, normalizeLng(lng)];
      placePoints.push(latLng);

      L.circleMarker(latLng, {
        radius: 4.8,
        color: "#544737",
        weight: 1.1,
        fillColor: "#d9cfbb",
        fillOpacity: 0.96,
        interactive: false
      }).addTo(map);

      if (typeof place.name === "string" && place.name.trim() !== "") {
        L.marker(latLng, {
          icon: L.divIcon({
            className: "family-place-label",
            html: "<span class=\"family-place-name\">" + escapeHtml(place.name) + "</span>",
            iconSize: [0, 0],
            iconAnchor: [8, -8]
          }),
          interactive: false,
          keyboard: false
        }).addTo(map);
      }
    });

    return placePoints;
  }

  function makeArcLatLngs(fromPlace, toPlace) {
    if (!fromPlace || !toPlace) {
      console.warn("[family-map] makeArcLatLngs() received missing place data.");
      return null;
    }

    var lat1 = Number(fromPlace.lat);
    var lng1 = normalizeLng(Number(fromPlace.lng));
    var lat2 = Number(toPlace.lat);
    var lng2 = normalizeLng(Number(toPlace.lng));

    if (!isFiniteNumber(lat1) || !isFiniteNumber(lng1) || !isFiniteNumber(lat2) || !isFiniteNumber(lng2)) {
      console.warn("[family-map] makeArcLatLngs() found invalid coordinates.");
      return null;
    }

    lng2 = shortestLngPath(lng1, lng2);

    var distanceKm = haversineKm({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 });
    var pointCount = clamp(Math.round(distanceKm / 75), 64, 260);

    var dx = lng2 - lng1;
    var dy = lat2 - lat1;
    var length = Math.sqrt(dx * dx + dy * dy) || 1;

    var nx = -dy / length;
    var ny = dx / length;
    var averageLat = (lat1 + lat2) / 2;

    var curvature = clamp(distanceKm / 2400, 0.45, 3.4);
    curvature *= 0.78 + 0.22 * Math.cos(toRadians(clamp(Math.abs(averageLat), 0, 75)));

    var direction = dx >= 0 ? 1 : -1;
    if (averageLat < 0) {
      direction *= -1;
    }

    var controlLng = (lng1 + lng2) / 2 + nx * curvature * direction;
    var controlLat = (lat1 + lat2) / 2 + ny * curvature * direction;

    var unwrapped = [];
    for (var i = 0; i <= pointCount; i += 1) {
      var t = i / pointCount;
      var oneMinusT = 1 - t;
      var lng = oneMinusT * oneMinusT * lng1 + 2 * oneMinusT * t * controlLng + t * t * lng2;
      var lat = oneMinusT * oneMinusT * lat1 + 2 * oneMinusT * t * controlLat + t * t * lat2;
      unwrapped.push({ lat: lat, lng: lng });
    }

    var segments = [[]];
    unwrapped.forEach(function (point) {
      var wrappedLng = normalizeLng(point.lng);
      var currentSegment = segments[segments.length - 1];
      if (currentSegment.length > 0) {
        var prevLng = currentSegment[currentSegment.length - 1][1];
        if (Math.abs(wrappedLng - prevLng) > 180) {
          currentSegment = [];
          segments.push(currentSegment);
        }
      }
      currentSegment.push([point.lat, wrappedLng]);
    });

    segments = segments.filter(function (segment) {
      return segment.length > 1;
    });

    if (segments.length === 0) {
      segments = [[[lat1, normalizeLng(lng1)], [lat2, normalizeLng(lng2)]]];
    }

    var midIndex = Math.floor(unwrapped.length / 2);
    var before = unwrapped[Math.max(midIndex - 1, 0)];
    var after = unwrapped[Math.min(midIndex + 1, unwrapped.length - 1)];
    var tangentX = after.lng - before.lng;
    var tangentY = after.lat - before.lat;
    var tangentLen = Math.sqrt(tangentX * tangentX + tangentY * tangentY) || 1;

    return {
      segments: segments,
      midpoint: [unwrapped[midIndex].lat, normalizeLng(unwrapped[midIndex].lng)],
      normal: [-tangentY / tangentLen, tangentX / tangentLen],
      distanceKm: distanceKm
    };
  }

  function addArrowHeads(map, arcData, color) {
    if (!arcData || !Array.isArray(arcData.segments) || arcData.segments.length === 0) {
      return null;
    }

    var finalSegment = arcData.segments[arcData.segments.length - 1];
    if (finalSegment.length < 2) {
      return null;
    }

    if (L.polylineDecorator && L.Symbol && L.Symbol.arrowHead) {
      var decoratorLayer = L.polylineDecorator(finalSegment, {
        patterns: [{
          offset: "100%",
          repeat: 0,
          symbol: L.Symbol.arrowHead({
            pixelSize: 6,
            headAngle: 52,
            polygon: true,
            pathOptions: {
              color: color,
              weight: 1.0,
              opacity: 0.98,
              fillColor: color,
              fillOpacity: 0.98,
              interactive: true
            }
          })
        }]
      }).addTo(map);
      return decoratorLayer;
    }

    // Fallback if decorator plugin fails to load.
    var prev = finalSegment[finalSegment.length - 2];
    var tip = finalSegment[finalSegment.length - 1];
    var vx = tip[1] - prev[1];
    var vy = tip[0] - prev[0];
    var len = Math.sqrt(vx * vx + vy * vy);
    if (len === 0) {
      return null;
    }

    var backX = -vx / len;
    var backY = -vy / len;
    var spread = 0.55;
    var wingLen = clamp(len * 4, 0.25, 1.1);

    var leftX = backX * Math.cos(spread) - backY * Math.sin(spread);
    var leftY = backX * Math.sin(spread) + backY * Math.cos(spread);
    var rightX = backX * Math.cos(-spread) - backY * Math.sin(-spread);
    var rightY = backX * Math.sin(-spread) + backY * Math.cos(-spread);

    var leftWing = [tip[0] + leftY * wingLen, tip[1] + leftX * wingLen];
    var rightWing = [tip[0] + rightY * wingLen, tip[1] + rightX * wingLen];

    var leftLayer = L.polyline([tip, leftWing], {
      color: color,
      weight: 1.4,
      opacity: 0.95,
      interactive: true
    }).addTo(map);

    var rightLayer = L.polyline([tip, rightWing], {
      color: color,
      weight: 1.4,
      opacity: 0.95,
      interactive: true
    }).addTo(map);

    return L.featureGroup([leftLayer, rightLayer]);
  }

  function getRouteStrokeWeight(zoom) {
    return clamp(1.2 + (zoom - 2) * 0.28, 1.2, 4.8);
  }

  function getRouteHitWeight(zoom) {
    return clamp(getRouteStrokeWeight(zoom) + 9.5, 9.5, 17);
  }

  function updateRouteLayerSizes(map, strokeLayers, hitLayers) {
    var zoom = map.getZoom();
    var strokeWeight = getRouteStrokeWeight(zoom);
    var hitWeight = getRouteHitWeight(zoom);

    strokeLayers.forEach(function (layer) {
      if (layer && typeof layer.setStyle === "function") {
        layer.setStyle({ weight: strokeWeight });
      }
    });

    hitLayers.forEach(function (layer) {
      if (layer && typeof layer.setStyle === "function") {
        layer.setStyle({ weight: hitWeight });
      }
    });
  }

  function getMoveDetailsHtml(move, peopleById) {
    var dateText = move && move.date ? String(move.date) : "Unknown date";
    var peopleIds = move && Array.isArray(move.people) ? move.people : [];
    var peopleNames = peopleIds.map(function (personId) {
      var person = peopleById[String(personId)];
      if (person && typeof person.name === "string" && person.name.trim() !== "") {
        return person.name.trim();
      }
      return String(personId);
    });
    var peopleLinesHtml = peopleNames.length > 0
      ? peopleNames.map(function (name) { return escapeHtml(name); }).join("<br>")
      : "Unknown";
    var noteText = move && move.note ? String(move.note) : "No description";

    return "<div class=\"family-route-details\">" +
      "<div><strong>Date:</strong> " + escapeHtml(dateText) + "</div>" +
      "<div><strong>People:</strong><div class=\"family-route-people-lines\">" + peopleLinesHtml + "</div></div>" +
      "<div><strong>Description:</strong> " + escapeHtml(noteText) + "</div>" +
      "</div>";
  }

  function bindMoveDetails(layer, detailsHtml) {
    if (!layer || !detailsHtml) {
      return;
    }

    var layers = [];
    if (typeof layer.eachLayer === "function") {
      layer.eachLayer(function (innerLayer) {
        layers.push(innerLayer);
      });
    }
    if (layers.length === 0) {
      layers.push(layer);
    }

    layers.forEach(function (entry) {
      if (typeof entry.bindTooltip === "function") {
        entry.bindTooltip(detailsHtml, {
          sticky: true,
          direction: "top",
          opacity: 0.98,
          className: "family-route-tooltip"
        });
      }

      if (typeof entry.bindPopup === "function") {
        entry.bindPopup(detailsHtml, {
          className: "family-route-popup",
          autoPan: true,
          closeButton: true
        });
      }
    });
  }

  function disableStaticRouteLabels() {
    // Intentionally kept as a no-op placeholder for backwards compatibility.
    // Route dates are now shown via hover/click tooltip/popup only.
  }

  function addRouteLabel(map, arcData, dateText, color) {
    disableStaticRouteLabels();
  }

  function renderMoves(map, moves, places, people) {
    if (!Array.isArray(moves)) {
      console.error("[family-map] renderMoves() expected an array.");
      return;
    }

    var placesById = buildPlacesById(places);
    var peopleById = buildPeopleById(people);
    var strokeLayers = [];
    var hitLayers = [];

    moves.forEach(function (move, index) {
      if (!move || typeof move !== "object") {
        console.warn("[family-map] Skipping invalid move entry.", move);
        return;
      }
      var moveId = move.id === undefined || move.id === null ? ("index_" + index) : String(move.id);

      var fromPlace = placesById[String(move.from)];
      var toPlace = placesById[String(move.to)];
      if (!fromPlace || !toPlace) {
        console.warn("[family-map] Skipping move with unknown place references:", moveId);
        return;
      }

      var peopleIds = Array.isArray(move.people) ? move.people : [];
      var primaryPerson = peopleIds.length > 0 ? peopleById[String(peopleIds[0])] : null;
      var routeColor = primaryPerson && typeof primaryPerson.color === "string"
        ? primaryPerson.color
        : DEFAULT_ROUTE_COLOR;

      // Shared move color rule: first person in move.people defines route color.
      var arcData = makeArcLatLngs(fromPlace, toPlace);
      if (!arcData) {
        console.warn("[family-map] Could not compute arc for move:", moveId);
        return;
      }
      var moveDetailsHtml = getMoveDetailsHtml(move, peopleById);
      var routeStrokeWeight = getRouteStrokeWeight(map.getZoom());
      var routeHitWeight = getRouteHitWeight(map.getZoom());

      arcData.segments.forEach(function (segment) {
        var segmentStrokeLayer = L.polyline(segment, {
          color: routeColor,
          opacity: 0.84,
          weight: routeStrokeWeight,
          smoothFactor: 2.2,
          lineCap: "round",
          lineJoin: "round",
          interactive: false
        }).addTo(map);
        strokeLayers.push(segmentStrokeLayer);

        var segmentHitLayer = L.polyline(segment, {
          color: routeColor,
          opacity: 0.01,
          weight: routeHitWeight,
          smoothFactor: 2.2,
          lineCap: "round",
          lineJoin: "round",
          interactive: true
        }).addTo(map);
        hitLayers.push(segmentHitLayer);
        bindMoveDetails(segmentHitLayer, moveDetailsHtml);
      });

      var arrowLayer = addArrowHeads(map, arcData, routeColor);
      bindMoveDetails(arrowLayer, moveDetailsHtml);
    });

    updateRouteLayerSizes(map, strokeLayers, hitLayers);
    map.on("zoomend", function () {
      updateRouteLayerSizes(map, strokeLayers, hitLayers);
    });
  }

  function initMap() {
    var mapElement = document.getElementById(MAP_ELEMENT_ID);
    if (!mapElement) {
      console.error("[family-map] Map element #" + MAP_ELEMENT_ID + " not found.");
      return null;
    }

    if (typeof L === "undefined") {
      console.error("[family-map] Leaflet (window.L) is not available.");
      return null;
    }

    var map = L.map(MAP_ELEMENT_ID, {
      zoomControl: true,
      maxBounds: [[-85, 0], [85, 360]],
      maxBoundsViscosity: 1.0,
      worldCopyJump: false
    }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd",
      maxZoom: 18,
      minZoom: 2,
      attribution:
        "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> " +
        "contributors &copy; <a href=\"https://carto.com/attributions\">CARTO</a>"
    }).addTo(map);

    var data = getFamilyMapData();
    renderLegend(data.people);

    var placePoints = renderPlaces(map, data.places);
    renderMoves(map, data.moves, data.places, data.people);

    if (placePoints.length > 0) {
      var bounds = L.latLngBounds(placePoints);
      if (bounds.isValid()) {
        map.fitBounds(bounds.pad(0.55));
      }
    }

    return map;
  }

  function runWhenReady() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initMap);
      return;
    }
    initMap();
  }

  runWhenReady();

  window.FamilyMap = {
    initMap: initMap,
    renderPlaces: renderPlaces,
    renderMoves: renderMoves,
    makeArcLatLngs: makeArcLatLngs,
    addArrowHeads: addArrowHeads,
    addRouteLabel: addRouteLabel,
    getMoveDetailsHtml: getMoveDetailsHtml
  };
})();
