// =================== Jeddah UHI Visualization ===================


// 1) Define Jeddah city center and 30 km ROI
var jeddahCenter = ee.Geometry.Point([39.19797, 21.48581]);   // Jeddah city center

var roi = jeddahCenter.buffer(30000);   // 30 km = 30,000 meters

Map.setCenter(39.19797, 21.48581, 10);
Map.addLayer(roi, {color: 'blue'}, 'Jeddah 30km ROI');

// 2) Dynamic World mask for urban and rural
var dw = ee.ImageCollection("GOOGLE/DYNAMICWORLD/V1")
  .select('label')
  .filterDate('2020-07-01','2024-09-30')
  .filterBounds(roi)
  .filter(ee.Filter.calendarRange(7,9,'month'))
  .mode();

var urbanMask = dw.eq(6);
var nonUrbanMask = dw.neq(6);
var notBareMask = dw.neq(7);
var ruralMask = nonUrbanMask.and(notBareMask);

// 3) Helper function to compute LST
function computeLST(img){
  var gain = ee.Number(img.get('TEMPERATURE_MULT_BAND_ST_B10'));
  var offset = ee.Number(img.get('TEMPERATURE_ADD_BAND_ST_B10'));
  var lstC = img.select('ST_B10').multiply(gain).add(offset).subtract(273.15).rename('LST');
  return img.addBands(lstC);
}

// 4) Compute yearly UHI metrics for 2020 & 2024
function computeYearlyUHI(year){
  var start = ee.Date.fromYMD(year,7,1);
  var end = ee.Date.fromYMD(year,9,30);
  var col = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
    .filterBounds(roi)
    .filterDate(start,end)
    .filter(ee.Filter.lt('CLOUD_COVER',10))
    .map(computeLST);

  var median = col.median().clip(roi);

  var meanUrban = median.select('LST').updateMask(urbanMask).reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: roi,
    scale: 100,
    maxPixels: 1e13
  }).get('LST');

  var meanRural = median.select('LST').updateMask(ruralMask).reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: roi,
    scale: 100,
    maxPixels: 1e13
  }).get('LST');

  var uhiVal = ee.Number(meanUrban).subtract(meanRural);

  return ee.Feature(null,{
    'year': year,
    'Mean_Urban': meanUrban,
    'Mean_Rural': meanRural,
    'UHI_Intensity': uhiVal,
    'Median_Image': median
  });
}

var metricsFC = ee.FeatureCollection([computeYearlyUHI(2020), computeYearlyUHI(2024)]);

// 5) Create UHI Images for 2020 & 2024
function getUHIImage(year){
  var feat = ee.Feature(metricsFC.filter(ee.Filter.eq('year',year)).first());
  var lstImg = ee.Image(feat.get('Median_Image')).select('LST');
  var meanRural = ee.Number(feat.get('Mean_Rural'));
  return lstImg.subtract(meanRural).rename('UHI_Spatial').clip(roi);
}

var uhi2020 = getUHIImage(2020);
var uhi2024 = getUHIImage(2024);

// 6) Compute 90% stretch for visualization (server-side safe)
function stretch90(img){
  var stats = img.reduceRegion({
    reducer: ee.Reducer.percentile([5,95]),
    geometry: roi,
    scale: 100,
    maxPixels: 1e13
  });
  var p5 = ee.Number(stats.get('UHI_Spatial_p5'));
  var p95 = ee.Number(stats.get('UHI_Spatial_p95'));
  return img.visualize({min: p5, max: p95, palette:['blue','white','red']});
}

var uhiVis2020 = stretch90(uhi2020);
var uhiVis2024 = stretch90(uhi2024);

// 7) Map display (both layers visible)
ui.root.clear();
var map = ui.Map();
map.setCenter(46.7219,24.6877,10);
ui.root.add(map);

map.addLayer(roi, {color: 'green'}, 'ROI');
//map.addLayer(uhi2020, {min:-5, max:5, palette:['blue','white','red']}, 'UHI 2020 Raw');
//map.addLayer(uhi2024, {min:-5, max:5, palette:['blue','white','red']}, 'UHI 2024 Raw');

// Optional: add visualized layers for GEE presentation
map.addLayer(uhiVis2020, {}, 'UHI 2020 Visualized');
map.addLayer(uhiVis2024, {}, 'UHI 2024 Visualized');

// // 8) Export raw numeric UHI values (GeoTIFF)
// Export.image.toDrive({
//   image: uhi2020,
//   description:'UHI_2020_Riyadh_30km_Raw',
//   fileFormat:'GeoTIFF',
//   region: roi,
//   scale: 100
// });

// Export.image.toDrive({
//   image: uhi2024,
//   description:'UHI_2024_Riyadh_30km_Raw',
//   fileFormat:'GeoTIFF',
//   region: roi,
//   scale: 100
// });

// 9) Export 90% stretch visualization (RGB) as GeoTIFF
Export.image.toDrive({
  image: uhiVis2020,
  description:'UHI_2020_Jeddah_30km_RGB',
  fileFormat:'GeoTIFF',
  region: roi,
  scale: 100
});

Export.image.toDrive({
  image: uhiVis2024,
  description:'UHI_2024_Jeddah_30km_RGB',
  fileFormat:'GeoTIFF',
  region: roi,
  scale: 100
});
