import React, { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';

const Map = forwardRef(({ onLocationSelect, radius, onSearch, onMarkerClick, onBusinessSearch }, ref) => {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markersRef = useRef([]);
  const currentMarker = useRef(null);
  const currentCircle = useRef(null);
  const selectedLocationRef = useRef(null);
  const markerClusterer = useRef(null);
  const markersInfoRef = useRef({});
  const businessMarkersRef = useRef([]);
  const businessCircleRef = useRef(null);

  const clearBusinessMarkers = useCallback(() => {
    businessMarkersRef.current.forEach(marker => marker.setMap(null));
    
    if (businessMarkersRef.current.lines) {
      businessMarkersRef.current.lines.forEach(line => line.setMap(null));
      businessMarkersRef.current.lines = [];
    }
    
    businessMarkersRef.current = [];
    
    if (Array.isArray(businessCircleRef.current)) {
      businessCircleRef.current.forEach(circle => circle.setMap(null));
    }
    businessCircleRef.current = [];
  }, []);

  const searchBusinesses = useCallback(async (businessType, searchRadius) => {
    clearBusinessMarkers();
    const allBusinesses = [];
    const locationScores = {};

    const vacantLocations = Object.keys(markersInfoRef.current).map(key => {
      const [lat, lng] = key.split(',').map(Number);
      return { lat, lng };
    });

    // 먼저 선택된 위치의 가장 가까운 공실 3개 데이터 수집
    if (selectedLocationRef.current) {
      try {
        const response = await fetch(
          `http://localhost:8000/api/nearest-vacant-listings/?` +
          `lat=${selectedLocationRef.current.lat}&` +
          `lng=${selectedLocationRef.current.lng}`
        );
        
        if (!response.ok) throw new Error('가까운 공실 데이터 수집 실패');
        await response.json(); // 응답 데이터는 백엔드에서 자동 저장됨
      } catch (error) {
        console.error('공실 데이터 수집 중 오류:', error);
      }
    }

    for (const location of vacantLocations) {
      const circle = new window.google.maps.Circle({
        map: mapInstance.current,
        center: location,
        radius: searchRadius,
        fillColor: '#00FF00',
        fillOpacity: 0.1,
        strokeColor: '#00FF00',
        strokeWeight: 1,
        clickable: false,
      });
      
      if (!businessCircleRef.current) {
        businessCircleRef.current = [];
      }
      businessCircleRef.current.push(circle);

      try {
        const response = await fetch(
          `http://localhost:8000/commercial-buildings/nearby/?` +
          `lat=${location.lat}&` +
          `lng=${location.lng}&` +
          `radius=${searchRadius}&` +
          `industry_category=${encodeURIComponent(businessType)}`
        );
        
        if (!response.ok) throw new Error('상가 검색 실패');
        
        const businesses = await response.json();
        const nearbyBusinesses = businesses.filter(b => b.distance <= searchRadius);
        
        let validBusinessCount = 0;
        const totalScore = nearbyBusinesses.reduce((sum, b) => {
          if (b.sales_level) {
            validBusinessCount++;
            return sum + (b.sales_level === '상' ? 3 : b.sales_level === '중' ? 2 : 1);
          }
          return sum;
        }, 0);
        
        const avgSalesLevel = validBusinessCount > 0 
          ? (totalScore / validBusinessCount).toFixed(2)
          : '0.00';

        const locationKey = `${location.lat},${location.lng}`;
        locationScores[locationKey] = {
          avgSalesLevel,
          count: validBusinessCount,
          nearbyBusinesses: nearbyBusinesses.map(business => ({
            ...business,
            distance: Math.round(business.distance)
          }))
        };

        businesses.forEach(newBusiness => {
          const isDuplicate = allBusinesses.some(
            existingBusiness => 
              existingBusiness.latitude === newBusiness.latitude && 
              existingBusiness.longitude === newBusiness.longitude
          );
          
          if (!isDuplicate) {
            allBusinesses.push(newBusiness);
          }
        });

        businesses.forEach(business => {
          const marker = new window.google.maps.Marker({
            position: { lat: business.latitude, lng: business.longitude },
            map: mapInstance.current,
            icon: {
              path: window.google.maps.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: "#FF0000",
              fillOpacity: 0.7,
              strokeWeight: 1,
              strokeColor: "#FFFFFF"
            },
            title: `${business.industry_category}\n매출등급: ${business.sales_level}`
          });

          const infoWindow = new window.google.maps.InfoWindow({
            content: `
              <div style="padding: 10px;">
                <h4 style="margin: 0 0 5px 0;">${business.industry_category}</h4>
                <p style="margin: 0;">매출등급: ${business.sales_level}</p>
                <p style="margin: 5px 0 0 0;">거리: ${Math.round(business.distance)}m</p>
              </div>
            `
          });

          marker.addListener('click', () => {
            infoWindow.open(mapInstance.current, marker);
          });

          businessMarkersRef.current.push(marker);
        });

        console.log(`위치 ${locationKey} 계산:`, {
          totalScore,
          validBusinessCount,
          avgSalesLevel,
          businesses: nearbyBusinesses.map(b => b.sales_level)
        });

      } catch (error) {
        console.error('상가 검색 중 오류:', error);
      }
    }

    if (onBusinessSearch) {
      onBusinessSearch(businessType, searchRadius, locationScores);
    }
  }, [clearBusinessMarkers]);

  const clearCurrentMarkerAndCircle = useCallback(() => {
    if (currentMarker.current) {
      currentMarker.current.setMap(null);
      currentMarker.current = null;
    }
    if (currentCircle.current) {
      currentCircle.current.setMap(null);
      currentCircle.current = null;
    }
    if (markerClusterer.current) {
      markerClusterer.current.clearMarkers();
    }
    markersRef.current = [];
    
    markersInfoRef.current = {};
    
    clearBusinessMarkers();
    onBusinessSearch({ businesses: [], scores: {} });
  }, [clearBusinessMarkers, onBusinessSearch]);

  const updateMarkerStyle = useCallback((lat, lng, isHighlighted) => {
    const key = `${lat},${lng}`;
    const markerInfo = markersInfoRef.current[key];
    if (markerInfo) {
      const { marker, locationGroup } = markerInfo;
      marker.setIcon({
        ...marker.getIcon(),
        fillColor: isHighlighted ? "#FFFFFF" : "#4285F4",
      });
      marker.setLabel({
        ...marker.getLabel(),
        color: isHighlighted ? "#4285F4" : "#FFFFFF",
      });
    }
  }, []);

  const createMarker = useCallback((lat, lng, locationGroup, isHighlighted = false) => {
    const marker = new window.google.maps.Marker({
      position: { lat, lng },
      map: mapInstance.current,
      title: `공실 ${locationGroup.length}개`,
      icon: {
        path: window.google.maps.SymbolPath.CIRCLE,
        scale: Math.max(12, Math.min(locationGroup.length * 3, 20)),
        fillColor: isHighlighted ? "#FFFFFF" : "#4285F4",
        fillOpacity: 0.8,
        strokeWeight: 0,
        strokeColor: "#4285F4",
        labelOrigin: new window.google.maps.Point(0, 0),
      },
      label: {
        text: String(locationGroup.length),
        color: isHighlighted ? "#4285F4" : "#FFFFFF",
        fontSize: "11px",
        fontWeight: "bold"
      }
    });

    const infoWindow = new window.google.maps.InfoWindow({
      content: `
        <div style="max-height: 300px; overflow-y: auto;">
          <h3>총 ${locationGroup.length}개의 공실</h3>
          ${locationGroup.map(location => `
            <div style="border-bottom: 1px solid #eee; padding: 8px 0;">
              <p style="font-weight: bold; margin: 4px 0;">${location.property_type}</p>
              <p style="margin: 4px 0;">보증금: ${location.deposit}만원</p>
              <p style="margin: 4px 0;">월: ${location.monthly_rent}만원</p>
              <p style="margin: 4px 0;">면적: ${location.area1}㎡</p>
              <p style="margin: 4px 0;">층: ${location.floor_info}</p>
            </div>
          `).join('')}
        </div>
      `
    });

    marker.addListener('click', () => {
      Object.entries(markersInfoRef.current).forEach(([markerKey, info]) => {
        const [markerLat, markerLng] = markerKey.split(',').map(Number);
        updateMarkerStyle(markerLat, markerLng, false);
      });
      
      updateMarkerStyle(lat, lng, true);

      if (onMarkerClick) {
        onMarkerClick(lat, lng);
      }
      infoWindow.open(mapInstance.current, marker);
    });

    return { marker, infoWindow };
  }, [onMarkerClick, updateMarkerStyle]);

  useImperativeHandle(ref, () => ({
    showInfoWindow: (lat, lng) => {
      const key = `${lat},${lng}`;
      const markerInfo = markersInfoRef.current[key];
      if (markerInfo) {
        const { marker, infoWindow } = markerInfo;
        
        Object.entries(markersInfoRef.current).forEach(([markerKey, info]) => {
          const [markerLat, markerLng] = markerKey.split(',').map(Number);
          updateMarkerStyle(markerLat, markerLng, false);
        });
        
        updateMarkerStyle(lat, lng, true);
        
        infoWindow.open(mapInstance.current, marker);
        mapInstance.current.panTo(marker.getPosition());
      }
    },
    searchBusinesses
  }), [updateMarkerStyle, searchBusinesses]);

  const performSearch = useCallback(async () => {
    if (!selectedLocationRef.current) return;

    clearBusinessMarkers();
    onBusinessSearch({ businesses: [], scores: {} });

    if (markerClusterer.current) {
      markerClusterer.current.clearMarkers();
    }
    markersRef.current = [];

    if (currentCircle.current) {
      currentCircle.current.setMap(null);
    }
    
    const circle = new window.google.maps.Circle({
      map: mapInstance.current,
      center: selectedLocationRef.current,
      radius: radius,
      fillColor: '#FF0000',
      fillOpacity: 0.1,
      strokeColor: '#FF0000',
      strokeWeight: 0,
      clickable: false,
    });
    currentCircle.current = circle;

    try {
      const response = await fetch(
        `http://localhost:8000/api/locations/search?` +
        `lat=${selectedLocationRef.current.lat}&` +
        `lng=${selectedLocationRef.current.lng}&` +
        `radius=${radius}`
      );
      
      if (!response.ok) throw new Error('API 요청 실패');
      
      const locations = await response.json();
      
      const groupedLocations = locations.reduce((acc, location) => {
        const key = `${location.latitude},${location.longitude}`;
        if (!acc[key]) {
          acc[key] = [];
        }
        acc[key].push(location);
        return acc;
      }, {});

      const markers = Object.entries(groupedLocations).map(([key, locationGroup]) => {
        const [lat, lng] = key.split(',').map(Number);
        const { marker, infoWindow } = createMarker(lat, lng, locationGroup);
        markersInfoRef.current[key] = { marker, infoWindow, locationGroup };
        return marker;
      });

      markersRef.current = markers;

      if (markerClusterer.current) {
        markerClusterer.current.clearMarkers();
      }

      markerClusterer.current = new window.markerClusterer.MarkerClusterer({
        map: mapInstance.current,
        markers: markers,
        algorithm: new window.markerClusterer.SuperClusterAlgorithm({
          radius: 100,
          maxZoom: 15
        }),
        renderer: {
          render: ({ count, position }) => {
            return new window.google.maps.Marker({
              position,
              icon: {
                path: window.google.maps.SymbolPath.CIRCLE,
                scale: Math.max(20, Math.min(count * 5, 40)),
                fillColor: "#4285F4",
                fillOpacity: 0.7,
                strokeWeight: 0,
                strokeColor: "#FFFFFF",
                labelOrigin: new window.google.maps.Point(0, 0),
              },
              label: {
                text: String(count),
                color: "white",
                fontSize: "12px",
                fontWeight: "bold"
              },
              zIndex: Number(window.google.maps.Marker.MAX_ZINDEX) + count,
            });
          }
        }
      });

      if (onLocationSelect) {
        onLocationSelect({
          address: selectedLocationRef.current.address,
          coordinates: {
            lat: selectedLocationRef.current.lat,
            lng: selectedLocationRef.current.lng
          },
          searchResults: locations
        });
      }
    } catch (error) {
      console.error('검색 실패:', error);
    }
  }, [radius, onLocationSelect, createMarker, clearBusinessMarkers, onBusinessSearch]);

  useEffect(() => {
    if (!window.google || !mapRef.current) return;

    const initMap = new window.google.maps.Map(mapRef.current, {
      center: { lat: 35.8500, lng: 128.7422 },
      zoom: 14,
      mapTypeControl: false,
      fullscreenControl: false,
      styles: [
        {
          featureType: "all",
          elementType: "labels.icon",
          stylers: [{ visibility: "off" }]
        },
        {
          featureType: "transit.station.rail",
          elementType: "labels",
          stylers: [{ visibility: "on" }]
        },
        {
          featureType: "transit.station.rail",
          elementType: "labels.text.fill",
          stylers: [
            { color: "#4285F4" },
            { weight: 2 }
          ]
        },
        {
          featureType: "transit.station.rail",
          elementType: "labels.text.stroke",
          stylers: [
            { color: "#ffffff" },
            { weight: 3 }
          ]
        },
        {
          featureType: "transit.station.bus",
          elementType: "labels",
          stylers: [{ visibility: "on" }]
        },
        {
          featureType: "transit.station.bus",
          elementType: "labels.text.fill",
          stylers: [
            { color: "#34A853" },
            { weight: 2 }
          ]
        },
        {
          featureType: "transit.station.bus",
          elementType: "labels.text.stroke",
          stylers: [
            { color: "#ffffff" },
            { weight: 3 }
          ]
        }
      ]
    });

    mapInstance.current = initMap;

    const clickListener = initMap.addListener('click', (event) => {
      clearCurrentMarkerAndCircle();

      const marker = new window.google.maps.Marker({
        position: event.latLng,
        map: initMap,
      });
      currentMarker.current = marker;
      
      const location = {
        lat: event.latLng.lat(),
        lng: event.latLng.lng()
      };
      
      console.log('선택된 위치:', {
        위도: location.lat,
        경도: location.lng
      });

      selectedLocationRef.current = location;

      const geocoder = new window.google.maps.Geocoder();
      geocoder.geocode({ location: location }, (results, status) => {
        if (status === 'OK' && results[0]) {
          const roadAddress = results.find(result => 
            result.types.includes('route') || result.types.includes('street_address')
          ) || results[0];

          onLocationSelect({
            address: roadAddress.formatted_address,
            coordinates: location,
            radius: radius
          });
        }
      });
    });

    return () => {
      window.google.maps.event.removeListener(clickListener);
      clearCurrentMarkerAndCircle();
    };
  }, [clearCurrentMarkerAndCircle, radius, onLocationSelect]);

  useEffect(() => {
    if (onSearch) {
      onSearch.current = performSearch;
    }
  }, [onSearch, performSearch]);

  return (
    <div>
      <div ref={mapRef} style={{ width: '100%', height: '100vh' }} />
    </div>
  );
});

export default Map;