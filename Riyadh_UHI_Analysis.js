// =================== Riyadh UHI Analysis ===================

// 1) Define Riyadh city center and 30 km ROI
var riyadhCenter = ee.Geometry.Point([46.7219, 24.6877]);
var roi = riyadhCenter.buffer(30000); // 30 km

Map.setCenter(46.7219, 24.6877, 10);
Map.addLayer(roi, {color: 'green'}, 'Riyadh 30km ROI');

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

// 6) Compute 90% stretch (server-side safe)
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

// 7) UI Panels
ui.root.clear();
var leftPanel = ui.Panel({style:{width:'48%',padding:'8px'}});
var rightPanel = ui.Panel({style:{width:'48%',padding:'8px'}});
ui.root.add(leftPanel);
ui.root.add(rightPanel);

// Map
var map = ui.Map();
map.setCenter(46.7219,24.6877,10);
leftPanel.add(ui.Label('Map: UHI 2020 & 2024', {fontWeight:'bold'}));
leftPanel.add(map);

var layer2020 = ui.Map.Layer(uhi2020,{min:-5,max:5,palette:['blue','white','red']},'UHI 2020');
var layer2024 = ui.Map.Layer(uhi2024,{min:-5,max:5,palette:['blue','white','red']},'UHI 2024');
map.layers().reset([layer2020,layer2024]);

// Toggle layers
var show2020 = ui.Checkbox('Show UHI 2020',true);
var show2024 = ui.Checkbox('Show UHI 2024',false);
leftPanel.add(show2020); leftPanel.add(show2024);
layer2020.setShown(show2020.getValue());
layer2024.setShown(show2024.getValue());
show2020.onChange(function(val){layer2020.setShown(val);});
show2024.onChange(function(val){layer2024.setShown(val);});

// 8) Display numeric summary
rightPanel.add(ui.Label('Selected-year numeric summary',{fontWeight:'bold'}));
metricsFC.evaluate(function(fc){
  fc.features.forEach(function(f){
    var props = f.properties;
    rightPanel.add(ui.Label(props.year + ': Mean Urban LST: ' + Number(props.Mean_Urban).toFixed(2)+' °C'));
    rightPanel.add(ui.Label(props.year + ': Mean Rural LST: ' + Number(props.Mean_Rural).toFixed(2)+' °C'));
    rightPanel.add(ui.Label(props.year + ': UHI Intensity: ' + Number(props.UHI_Intensity).toFixed(2)+' °C'));
    rightPanel.add(ui.Label(''));
  });
});

// 9) Export UHI maps
Export.image.toDrive({
  image: uhiVis2020,
  description:'UHI_2020_Riyadh_30km_new',
  fileFormat:'GeoTIFF',
  region: roi,
  scale: 100
});

Export.image.toDrive({
  image: uhiVis2024,
  description:'UHI_2024_Riyadh_30km_new',
  fileFormat:'GeoTIFF',
  region: roi,
  scale: 100
});

// 7) UI Panels simplified
ui.root.clear();
var map = ui.Map();
map.setCenter(46.7219,24.6877,10);
ui.root.add(map);

// Add ROI
map.addLayer(roi, {color: 'green'}, 'Riyadh 30km ROI');

// Add UHI layers directly (both visible by default)
map.addLayer(uhi2020, {min:-5, max:5, palette:['blue','white','red']}, 'UHI 2020');
map.addLayer(uhi2024, {min:-5, max:5, palette:['blue','white','red']}, 'UHI 2024');

