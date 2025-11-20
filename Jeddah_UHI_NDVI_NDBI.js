// ---------------------- (Jeddah AOI, 30 km buffer square) ----------------------
var point = ee.Geometry.Point([39.197, 21.485]);  // central Jeddah
var buffer_km = 30;
var roi = point.buffer(buffer_km * 1000).bounds().simplify(500); // square ROI
Map.setCenter(39.197, 21.485, 10);
Map.addLayer(roi, {color: 'red'}, 'ROI (Jeddah)');

// ---------------------- YEARS ----------------------
var START_YEAR = 2020;
var END_YEAR = 2024;
var years = ee.List.sequence(START_YEAR, END_YEAR);

// ---------------------- Dynamic World mask (single year to reduce cost) ----------------------
var dw2022 = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
  .filterDate('2022-01-01', '2022-12-31')
  .filterBounds(roi)
  .first();

var urbanMask = ee.Algorithms.If(dw2022, dw2022.select('label').eq(6), ee.Image(0));
urbanMask = ee.Image(urbanMask).clip(roi);

var notUrban = ee.Image(urbanMask).neq(1);
var notBare = ee.Image(ee.Algorithms.If(dw2022, dw2022.select('label').neq(7), ee.Image(1))).clip(roi);
var finalRuralMask = notUrban.and(notBare).clip(roi);

// ---------------------- Helper: convert Landsat --> ST_Celsius, NDVI, NDBI ----------------------
var SR_SCALE = 0.0000275;
var SR_OFFSET = -0.2;

function convertIndices(img) {
  var gain = ee.Number(img.get('TEMPERATURE_MULT_BAND_ST_B10'));
  var offset = ee.Number(img.get('TEMPERATURE_ADD_BAND_ST_B10'));
  var stC = img.select('ST_B10').multiply(gain).add(offset).subtract(273.15).rename('ST_Celsius');

  var red = img.select('SR_B4').multiply(SR_SCALE).add(SR_OFFSET);
  var nir = img.select('SR_B5').multiply(SR_SCALE).add(SR_OFFSET);
  var swir1 = img.select('SR_B6').multiply(SR_SCALE).add(SR_OFFSET);

  var ndvi = nir.subtract(red).divide(nir.add(red)).rename('NDVI');
  var ndbi = swir1.subtract(nir).divide(swir1.add(nir)).rename('NDBI');

  return ee.Image.cat([stC, ndvi, ndbi]).copyProperties(img, img.propertyNames());
}

// ---------------------- Build per-year composites and stats ----------------------
function buildYearImage(year) {
  year = ee.Number(year);
  var start = ee.Date.fromYMD(year, 7, 1);
  var end = ee.Date.fromYMD(year, 9, 30);

  var col = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
    .filterBounds(roi)
    .filterDate(start, end)
    .filter(ee.Filter.lt('CLOUD_COVER', 10))
    .map(convertIndices);

  var median = ee.Image(ee.Algorithms.If(
    col.size().gt(0),
    col.median().clip(roi),
    ee.Image.constant([0,0,0]).rename(['ST_Celsius','NDVI','NDBI']).updateMask(ee.Image(0)).clip(roi)
  ));

  var reducerOpts = {reducer: ee.Reducer.mean(), geometry: roi, scale: 250, bestEffort: true, maxPixels: 1e13};

  var meanUrban = median.select('ST_Celsius').updateMask(urbanMask).reduceRegion(reducerOpts).get('ST_Celsius');
  var meanRural = median.select('ST_Celsius').updateMask(finalRuralMask).reduceRegion(reducerOpts).get('ST_Celsius');
  var uhi = ee.Number(meanUrban).subtract(meanRural);

  var meanNDVI = median.select('NDVI').reduceRegion(reducerOpts).get('NDVI');
  var meanNDBI = median.select('NDBI').reduceRegion(reducerOpts).get('NDBI');

  return median.set({
    'year': year,
    'Mean_Urban': meanUrban,
    'Mean_Rural': meanRural,
    'UHI_Intensity': uhi,
    'Mean_NDVI': meanNDVI,
    'Mean_NDBI': meanNDBI
  });
}

var precompList = years.map(buildYearImage);
var precompCol = ee.ImageCollection(precompList);

// References for 2020 and 2024
var uhi2020_img = ee.Image(precompCol.filter(ee.Filter.eq('year', 2020)).first());
var uhi2024_img = ee.Image(precompCol.filter(ee.Filter.eq('year', 2024)).first());

// ---------------------- Time-series Feature Collection ----------------------
var fcTimes = ee.FeatureCollection(
  precompCol.map(function(img){
    return ee.Feature(null, {
      'year': img.get('year'),
      'UHI_Intensity': img.get('UHI_Intensity'),
      'Mean_NDVI': img.get('Mean_NDVI'),
      'Mean_NDBI': img.get('Mean_NDBI')
    });
  })
);

// ---------------------- UI LAYOUT ----------------------
ui.root.clear();

// Left Panel: Map + toggles
var leftPanel = ui.Panel({style: {width: '48%', padding: '8px'}});
ui.root.add(leftPanel);

var map = ui.Map();
map.setCenter(39.197, 21.485, 10);
leftPanel.add(ui.Label('Map: Toggle UHI layers (2020 / 2024)', {fontWeight: 'bold'}));
leftPanel.add(map);
map.addLayer(roi, {color:'red'}, 'ROI');

var show2020 = ui.Checkbox('Show UHI 2020', true);
var show2024 = ui.Checkbox('Show UHI 2024', false);
leftPanel.add(show2020);
leftPanel.add(show2024);

var visUHI = {min: -5, max: 5, palette: ['blue','white','red']};
var layer2020 = ui.Map.Layer(ee.Image(uhi2020_img.select('ST_Celsius').subtract(ee.Image.constant(uhi2020_img.get('Mean_Rural')))).clip(roi), visUHI, 'UHI 2020');
var layer2024 = ui.Map.Layer(ee.Image(uhi2024_img.select('ST_Celsius').subtract(ee.Image.constant(uhi2024_img.get('Mean_Rural')))).clip(roi), visUHI, 'UHI 2024');
map.layers().reset([layer2020, layer2024]);
layer2020.setShown(show2020.getValue());
layer2024.setShown(show2024.getValue());
show2020.onChange(function(c){layer2020.setShown(c);});
show2024.onChange(function(c){layer2024.setShown(c);});

// Right Panel: Charts + summary
var rightPanel = ui.Panel({style: {width: '48%', padding: '8px'}});
ui.root.add(rightPanel);

// ---- NDVI + NDBI time series chart ----
var tsNDVI_NDBI = ui.Chart.feature.byFeature(fcTimes.sort('year'), 'year', ['Mean_NDVI','Mean_NDBI'])
  .setChartType('LineChart')
  .setOptions({
    title: 'NDVI & NDBI Time Series (2020–2024)',
    hAxis: {title:'Year'},
    vAxis: {title:'Value'},
    lineWidth: 2,
    pointSize: 4,
    colors:['#2ca02c','#9467bd']
  });
rightPanel.add(tsNDVI_NDBI);

// ---- UHI time series chart ----
var tsUHI = ui.Chart.feature.byFeature(fcTimes.sort('year'), 'year', ['UHI_Intensity'])
  .setChartType('LineChart')
  .setOptions({
    title: 'UHI Intensity Time Series (2020–2024)',
    hAxis: {title:'Year'},
    vAxis: {title:'UHI (°C)'},
    lineWidth: 2,
    pointSize: 4,
    colors:['#d62728']
  });
rightPanel.add(tsUHI);

// ---------------------- GROUPED BAR CHART (UHI + NDVI + NDBI) ----------------------
var barChart = ui.Chart.feature.byFeature(
    fcTimes.sort('year'), "year", ["UHI_Intensity", "Mean_NDVI", "Mean_NDBI"]
  )
  .setChartType("ColumnChart")
  .setOptions({
    title: "Grouped Bar Chart (UHI, NDVI, NDBI)",
    hAxis: { title: "Year" },
    vAxis: { title: "Value" },
    colors: ["#d62728", "#2ca02c", "#9467bd"],
    legend: { position: 'top' },
    bar: { groupWidth: "70%" }
  });

rightPanel.add(barChart);

// ---- Numeric summary (2020 & 2024) ----
var infoBox = ui.Panel({style:{padding:'6px 0 0 0'}});
rightPanel.add(ui.Label('Selected-year numeric summary (2020 & 2024)', {fontWeight:'bold'}));
rightPanel.add(infoBox);

function showSummary() {
  infoBox.clear();
  [uhi2020_img, uhi2024_img].forEach(function(img){
    img.get('Mean_Urban').evaluate(function(mu){
      img.get('Mean_Rural').evaluate(function(mr){
        img.get('UHI_Intensity').evaluate(function(u){
          img.get('Mean_NDVI').evaluate(function(nd){
            img.get('Mean_NDBI').evaluate(function(nb){
              infoBox.add(ui.Label(img.get('year').getInfo() + ': Mean Urban LST: ' + (mu!==null?Number(mu).toFixed(2)+' °C':'No data')));
              infoBox.add(ui.Label(img.get('year').getInfo() + ': Mean Rural LST: ' + (mr!==null?Number(mr).toFixed(2)+' °C':'No data')));
              infoBox.add(ui.Label(img.get('year').getInfo() + ': UHI Intensity: ' + (u!==null?Number(u).toFixed(2)+' °C':'No data')));
              infoBox.add(ui.Label(img.get('year').getInfo() + ': Mean NDVI: ' + (nd!==null?Number(nd).toFixed(3):'No data')));
              infoBox.add(ui.Label(img.get('year').getInfo() + ': Mean NDBI: ' + (nb!==null?Number(nb).toFixed(3):'No data')));
              infoBox.add(ui.Label(''));
            });
          });
        });
      });
    });
  });
}
showSummary();
