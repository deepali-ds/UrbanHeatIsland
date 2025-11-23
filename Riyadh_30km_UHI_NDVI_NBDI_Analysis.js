// =================== Riyadh UHI + NDVI/NDBI Analysis ===================


// 1) Define Riyadh city center and 30 km ROI
var riyadhCenter = ee.Geometry.Point([46.7219, 24.6877]);   // Riyadh city center

var roi = riyadhCenter.buffer(30000);   // 30 km = 30,000 meters

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

// 3) Helper functions to compute LST, NDVI, NDBI
var SR_SCALE = 0.0000275;
var SR_OFFSET = -0.2;

function computeIndices(img){
  var gain = ee.Number(img.get('TEMPERATURE_MULT_BAND_ST_B10'));
  var offset = ee.Number(img.get('TEMPERATURE_ADD_BAND_ST_B10'));
  var lstC = img.select('ST_B10').multiply(gain).add(offset).subtract(273.15).rename('LST');

  // Surface Reflectance bands
  var red = img.select('SR_B4').multiply(SR_SCALE).add(SR_OFFSET);
  var nir = img.select('SR_B5').multiply(SR_SCALE).add(SR_OFFSET);
  var swir = img.select('SR_B6').multiply(SR_SCALE).add(SR_OFFSET);

  var ndvi = nir.subtract(red).divide(nir.add(red)).rename('NDVI');
  var ndbi = swir.subtract(nir).divide(swir.add(nir)).rename('NDBI');

  return img.addBands([lstC, ndvi, ndbi]);
}

// 4) Compute yearly metrics
var years = ee.List.sequence(2020,2024);

var metricsFC = ee.FeatureCollection(
  years.map(function(y){
    var start = ee.Date.fromYMD(y,7,1);
    var end = ee.Date.fromYMD(y,9,30);
    var col = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
      .filterBounds(roi)
      .filterDate(start,end)
      .filter(ee.Filter.lt('CLOUD_COVER',10))
      .map(computeIndices);

    var median = col.median().clip(roi);

    var meanUrban = median.select('LST').updateMask(urbanMask).reduceRegion({
      reducer: ee.Reducer.mean(), geometry: roi, scale:100, maxPixels:1e13
    }).get('LST');

    var meanRural = median.select('LST').updateMask(ruralMask).reduceRegion({
      reducer: ee.Reducer.mean(), geometry: roi, scale:100, maxPixels:1e13
    }).get('LST');

    var uhiVal = ee.Number(meanUrban).subtract(meanRural);

    var meanNDVI = median.select('NDVI').reduceRegion({
      reducer: ee.Reducer.mean(), geometry: roi, scale:100, maxPixels:1e13
    }).get('NDVI');

    var meanNDBI = median.select('NDBI').reduceRegion({
      reducer: ee.Reducer.mean(), geometry: roi, scale:100, maxPixels:1e13
    }).get('NDBI');

    return ee.Feature(null,{
      'year':y,
      'Mean_Urban':meanUrban,
      'Mean_Rural':meanRural,
      'UHI_Intensity':uhiVal,
      'Mean_NDVI':meanNDVI,
      'Mean_NDBI':meanNDBI,
      'Median_Image':median
    });
  })
);

// 5) Create UHI Images for 2020 & 2024
function getUHIImage(year){
  var feat = ee.Feature(metricsFC.filter(ee.Filter.eq('year',year)).first());
  var lstImg = ee.Image(feat.get('Median_Image')).select('LST');
  var meanRural = ee.Number(feat.get('Mean_Rural'));
  return lstImg.subtract(meanRural).rename('UHI_Spatial').clip(roi);
}

var uhi2020 = getUHIImage(2020);
var uhi2024 = getUHIImage(2024);

// 6) UI Panels
ui.root.clear();
var leftPanel = ui.Panel({style:{width:'48%',padding:'8px'}});
var rightPanel = ui.Panel({style:{width:'48%',padding:'8px'}});
ui.root.add(leftPanel);
ui.root.add(rightPanel);

// Map
var map = ui.Map();
map.setCenter(50.06395,26.4011,12);
leftPanel.add(ui.Label('Map: UHI 2020 & 2024', {fontWeight:'bold'}));
leftPanel.add(map);

var visUHI = {min:-5,max:5,palette:['blue','white','red']};
var layer2020 = ui.Map.Layer(uhi2020,visUHI,'UHI 2020');
var layer2024 = ui.Map.Layer(uhi2024,visUHI,'UHI 2024');
map.layers().reset([layer2020,layer2024]);

// Toggle layers
var show2020 = ui.Checkbox('Show UHI 2020',true);
var show2024 = ui.Checkbox('Show UHI 2024',false);
leftPanel.add(show2020); leftPanel.add(show2024);
layer2020.setShown(show2020.getValue());
layer2024.setShown(show2024.getValue());
show2020.onChange(function(val){layer2020.setShown(val);});
show2024.onChange(function(val){layer2024.setShown(val);});

// 7) Charts (Right Panel)
rightPanel.add(ui.Label('Bar Chart: UHI, NDVI, NDBI per year',{fontWeight:'bold'}));
var barChart = ui.Chart.feature.byFeature(metricsFC,'year',['UHI_Intensity','Mean_NDVI','Mean_NDBI'])
  .setChartType('ColumnChart')
  .setOptions({
    title:'Dammam: UHI, NDVI, NDBI per year',
    hAxis:{title:'Year'},
    vAxes:{0:{title:'UHI (°C)'},1:{title:'NDVI / NDBI'}},
    series:{0:{targetAxisIndex:0},1:{targetAxisIndex:1},2:{targetAxisIndex:1}},
    colors:['#d62728','#2ca02c','#9467bd']
  });
rightPanel.add(barChart);

rightPanel.add(ui.Label('Time Series: UHI',{fontWeight:'bold'}));
var uhiTS = ui.Chart.feature.byFeature(metricsFC,'year','UHI_Intensity')
  .setChartType('LineChart')
  .setOptions({lineWidth:2,pointSize:4,color:'#d62728',title:'UHI Time Series'});
rightPanel.add(uhiTS);

rightPanel.add(ui.Label('Time Series: NDVI & NDBI',{fontWeight:'bold'}));
var ndviNdbiTS = ui.Chart.feature.byFeature(metricsFC,'year',['Mean_NDVI','Mean_NDBI'])
  .setChartType('LineChart')
  .setOptions({lineWidth:2,pointSize:4,colors:['#2ca02c','#9467bd'],title:'NDVI & NDBI Time Series'});
rightPanel.add(ndviNdbiTS);

// 8) Display numeric summary
rightPanel.add(ui.Label('Selected-year numeric summary',{fontWeight:'bold'}));
metricsFC.evaluate(function(fc){
  fc.features.forEach(function(f){
    var props = f.properties;
    rightPanel.add(ui.Label(props.year + ': Mean Urban LST: ' + Number(props.Mean_Urban).toFixed(2)+' °C'));
    rightPanel.add(ui.Label(props.year + ': Mean Rural LST: ' + Number(props.Mean_Rural).toFixed(2)+' °C'));
    rightPanel.add(ui.Label(props.year + ': UHI Intensity: ' + Number(props.UHI_Intensity).toFixed(2)+' °C'));
    rightPanel.add(ui.Label(props.year + ': Mean NDVI: ' + Number(props.Mean_NDVI).toFixed(3)));
    rightPanel.add(ui.Label(props.year + ': Mean NDBI: ' + Number(props.Mean_NDBI).toFixed(3)));
    rightPanel.add(ui.Label(''));
  });
});

// 9) Export UHI maps 
// Export UHI maps as GeoTIFF
Export.image.toDrive({
  image: uhi2020.visualize(visUHI), // RGB visualization
  description:'UHI_2020_Riyadh_30km',
  fileFormat:'GeoTIFF',
  region:roi,
  scale:100
});

Export.image.toDrive({
  image: uhi2024.visualize(visUHI), // RGB visualization
  description:'UHI_2024_Riyadh_30km',
  fileFormat:'GeoTIFF',
  region:roi,
  scale:100
});