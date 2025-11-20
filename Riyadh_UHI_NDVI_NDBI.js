/*******************************
   RIYADH GOVERNORATE ANALYSIS  
   UHI + NDVI + NDBI
********************************/

var point = ee.Geometry.Point([46.6632, 24.714]);  // Riyadh
var roi = table.filterBounds(point).map(function(f){ 
  return f.simplify(1000); 
});
Map.addLayer(roi, {color: 'red'}, 'Riyadh Governorate');
Map.centerObject(roi, 8);

/***********************
  Dynamic World (urban mask)
***********************/
var dw = ee.ImageCollection("GOOGLE/DYNAMICWORLD/V1")
  .select('label')
  .filterDate('2020-07-01', '2024-09-30')
  .filterBounds(roi)
  .filter(ee.Filter.calendarRange(7, 9, 'month'))
  .mode();

var urban_mask = dw.eq(6);     // urban
var non_urban = dw.neq(6);     // non-urban
var bare_free = dw.neq(7);     // not bare ground
var final_rural_mask = non_urban.and(bare_free);

/***********************
  Rural Reference Zone
***********************/
var buffer_km = 30000;
var rural_zone = roi.geometry().buffer(buffer_km).difference(roi.geometry());

/***********************
  Function: NDVI, NDBI, UHI
***********************/
var years = ee.List([2020, 2024]);

var getMetrics = function(year){
  year = ee.Number(year);
  var start = ee.Date.fromYMD(year, 7, 1);
  var end   = ee.Date.fromYMD(year, 9, 30);

  // Landsat 8
  var coll = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
    .filterBounds(roi)
    .filterDate(start, end)
    .filter(ee.Filter.lt('CLOUD_COVER', 10))
    .map(function(img){

      // LST
      var gain = ee.Number(img.get('TEMPERATURE_MULT_BAND_ST_B10'));
      var offset = ee.Number(img.get('TEMPERATURE_ADD_BAND_ST_B10'));
      var lstC = img.select('ST_B10').multiply(gain).add(offset).subtract(273.15)
        .rename('LST');

      // SR scale
      var scale = 0.0000275;
      var offset_sr = -0.2;

      var red  = img.select('SR_B4').multiply(scale).add(offset_sr);
      var nir  = img.select('SR_B5').multiply(scale).add(offset_sr);
      var swir = img.select('SR_B6').multiply(scale).add(offset_sr);

      var ndvi = nir.subtract(red).divide(nir.add(red)).rename('NDVI');
      var ndbi = swir.subtract(nir).divide(swir.add(nir)).rename('NDBI');

      return ee.Image.cat(lstC, ndvi, ndbi)
        .copyProperties(img, img.propertyNames());
    });

  var merged = coll.median();

  // ------- Urban/Rural LST -------
  var meanUrban = merged.select('LST').updateMask(urban_mask)
      .reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: roi.geometry(),
        scale: 100,
        maxPixels: 1e13
      }).get('LST');

  var meanRural = merged.select('LST').updateMask(final_rural_mask)
      .reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: rural_zone,
        scale: 100,
        maxPixels: 1e13
      }).get('LST');

  var uhi_intensity = ee.Number(meanUrban).subtract(meanRural);

  // ------- Mean NDVI & NDBI (whole region) -------
  var meanNDVI = merged.select('NDVI').reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: roi.geometry(),
    scale: 100,
    maxPixels: 1e13
  }).get('NDVI');

  var meanNDBI = merged.select('NDBI').reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: roi.geometry(),
    scale: 100,
    maxPixels: 1e13
  }).get('NDBI');

  return merged.select('LST').subtract(ee.Image.constant(meanRural)).rename('UHI_Spatial')
    .set({
      'year': year,
      'UHI_Intensity': uhi_intensity,
      'Mean_NDVI': meanNDVI,
      'Mean_NDBI': meanNDBI
    });
};

/***********************
  Run for each year
***********************/
var results = ee.ImageCollection(years.map(getMetrics));

/***********************
  Build FeatureCollection for charts
***********************/
var fc = ee.FeatureCollection(results.map(function(img){
  return ee.Feature(null, {
    'year': img.get('year'),
    'UHI_Intensity': img.get('UHI_Intensity'),
    'Mean_NDVI': img.get('Mean_NDVI'),
    'Mean_NDBI': img.get('Mean_NDBI')
  });
}));

/***********************
  TIME SERIES CHARTS
***********************/
// UHI Timeseries
var tsUHI = ui.Chart.feature.byFeature(fc, 'year', ['UHI_Intensity'])
  .setChartType('LineChart')
  .setOptions({
    title:'UHI Intensity Timeseries',
    hAxis:{title:'Year'},
    vAxis:{title:'UHI (°C)'},
    lineWidth:3,
    pointSize:6,
    colors:['red']
  });
print(tsUHI);

// NDVI + NDBI Timeseries combined
var tsNDVI_NDBI = ui.Chart.feature.byFeature(fc, 'year', ['Mean_NDVI','Mean_NDBI'])
  .setChartType('LineChart')
  .setOptions({
    title:'NDVI & NDBI Timeseries',
    hAxis:{title:'Year'},
    vAxis:{title:'Value'},
    lineWidth:3,
    pointSize:6,
    colors:['green','purple']
  });
print(tsNDVI_NDBI);

/***********************
  GROUPED BAR CHART
***********************/
var barChart = ui.Chart.feature.byFeature(fc, 'year', ['UHI_Intensity','Mean_NDVI','Mean_NDBI'])
  .setChartType('ColumnChart')
  .setOptions({
    title: 'UHI Intensity, NDVI & NDBI (Grouped Bar Chart)',
    hAxis:{title:'Year'},
    vAxes:{
      0:{title:'UHI (°C)'},
      1:{title:'NDVI / NDBI'}
    },
    series:{
      0:{targetAxisIndex:0,color:'red'},
      1:{targetAxisIndex:1,color:'green'},
      2:{targetAxisIndex:1,color:'purple'}
    },
    bar:{groupWidth:'70%'},
    legend:{position:'top'}
  });
print(barChart);

/***********************
  MAP VISUALIZATION
***********************/
var vis = {min:-5,max:5,palette:['blue','white','red']};
Map.addLayer(results.filter(ee.Filter.eq('year',2020)).first().clip(roi), vis, 'UHI 2020');
Map.addLayer(results.filter(ee.Filter.eq('year',2024)).first().clip(roi), vis, 'UHI 2024');
