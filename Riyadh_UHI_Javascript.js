// This is GEE code in Javascript
var point = ee.Geometry.Point([46.6632, 24.714]);  // Riyadh
var roi = table.filterBounds(point).map(function(f){ return f.simplify(1000); });
Map.addLayer(roi, {color: 'red'}, 'Riyadh Governorate Boundary');

Map.centerObject(roi, 8);


// ----------------- Get Dynamic World mask (2020–2024 summer) -----------------
var dw = ee.ImageCollection("GOOGLE/DYNAMICWORLD/V1")
  .select('label')
  .filterDate('2020-07-01', '2024-09-30')
  .filterBounds(roi)
  .filter(ee.Filter.calendarRange(7, 9, 'month'))  // July–September
  .mode();

var urban_mask_dw = dw.eq(6);  // Urban
var non_urban_mask_dw = dw.neq(6);  // Not Urban
var bare_ground_mask = dw.neq(7);   // Not Bare Ground

var final_rural_mask = non_urban_mask_dw.and(bare_ground_mask);

// ----------------- Define rural reference area -----------------
var rural_buffer_distance = 30000;
var rural_area_candidate = roi.geometry().buffer(rural_buffer_distance);
var rural_reference_geometry = rural_area_candidate.difference(roi.geometry());

// ----------------- UHI Computation -----------------
var years = ee.List([2020, 2024]);

var getUHI = function(year){
  year = ee.Number(year);
  var start = ee.Date.fromYMD(year, 7, 1);
  var end = ee.Date.fromYMD(year, 9, 30);

  // Load Landsat 8 images
  var landsat = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
    .filterBounds(roi)
    .filterDate(start, end)
    .filter(ee.Filter.lt('CLOUD_COVER', 10))
    .map(function(img){
      var gain = ee.Number(img.get('TEMPERATURE_MULT_BAND_ST_B10'));
      var offset = ee.Number(img.get('TEMPERATURE_ADD_BAND_ST_B10'));
      var tempC = img.select('ST_B10').multiply(gain).add(offset).subtract(273.15);
      return tempC.rename('ST_Celsius');
    });

  var lst = landsat.median();

  // Mean Urban LST
  var urban = lst.updateMask(urban_mask_dw);
  var meanUrban = urban.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: roi.geometry(),
    scale: 100,
    maxPixels: 1e13
  }).get('ST_Celsius');

  // Mean Rural LST
  var rural = lst.updateMask(final_rural_mask).clip(rural_reference_geometry);
  var meanRural = rural.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: rural_reference_geometry,
    scale: 100,
    maxPixels: 1e13
  }).get('ST_Celsius');

  // UHI = Urban - Rural
  var uhi_intensity = ee.Number(meanUrban).subtract(meanRural);

  return ee.Image(lst.subtract(ee.Image.constant(meanRural)).rename('UHI_Spatial'))
    .set('year', year)
    .set('Mean_Urban', meanUrban)
    .set('Mean_Rural', meanRural)
    .set('UHI_Intensity', uhi_intensity);
};

// ----------------- Process and Print -----------------
var uhiCollection = ee.ImageCollection(years.map(getUHI));

// Print summary
uhiCollection.aggregate_array('year').evaluate(function(y){
  print('Years:', y);
});
uhiCollection.aggregate_array('Mean_Urban').evaluate(function(urban){
  print('Mean Urban LSTs:', urban);
});
uhiCollection.aggregate_array('Mean_Rural').evaluate(function(rural){
  print('Mean Rural LSTs:', rural);
});
uhiCollection.aggregate_array('UHI_Intensity').evaluate(function(intensity){
  print('UHI Intensities (Urban - Rural):', intensity);
});

// ----------------- Optional: Visualize -----------------
Map.centerObject(roi, 10);
var vis = {min: -5, max: 5, palette: ['blue', 'white', 'red']};

var uhi2020 = ee.Image(uhiCollection.filter(ee.Filter.eq('year', 2020)).first());
var uhi2024 = ee.Image(uhiCollection.filter(ee.Filter.eq('year', 2024)).first());

Map.addLayer(uhi2020.clip(roi), vis, 'UHI 2020');
Map.addLayer(uhi2024.clip(roi), vis, 'UHI 2024');

// Set visualization parameters
var visParams = {
  min: -5,
  max: 5,
  palette: ['blue', 'white', 'red']
};

// Apply visualization to turn UHI values into RGB image
var uhi_vis = uhi2020.visualize(visParams).clip(roi);

// Export the RGB image
Export.image.toDrive({
  image: uhi_vis,
  description: 'UHI_2020_Riyadh_RGB',
  folder: 'EarthEngineExports',
  fileNamePrefix: 'UHI_2020_Riyadh_RGB',
  region: roi.geometry(),
  scale: 100,
  crs: 'EPSG:4326',
  maxPixels: 1e13
});


// Export 2024 UHI
Export.image.toDrive({
  image: uhi2024.clip(roi),
  description: 'UHI_2024_Riyadh',
  folder: 'EarthEngineExports',
  fileNamePrefix: 'uhi_riyadh_2024',
  region: roi.geometry(),
  scale: 100,
  crs: 'EPSG:4326',
  maxPixels: 1e13
});
