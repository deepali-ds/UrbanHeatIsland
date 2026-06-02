🌆 Urban Heat Island (UHI) Analysis for Riyadh Using Google Earth Engine

This repository contains a Google Earth Engine (GEE) script that computes Urban Heat Island (UHI) intensity for Riyadh Governorate using Landsat 8 thermal data and Dynamic World urban classification for the period 2020–2024 (summer months).

The workflow identifies urban vs. rural surfaces, extracts land surface temperature (LST) from Landsat 8, and computes UHI as:

UHI = Mean Urban LST − Mean Rural LST


The script also visualizes UHI maps and exports them as RGB images.

 Key Features
 1. Riyadh Governorate Boundary Extraction

Selects the region of interest (ROI) using a provided geojson file

Applies geometric simplification.

Automatically centers the map on the ROI.

 2. Dynamic World (2020–2024 Summer) Land Classification

Loads Dynamic World collection.

Filters for July–September (summer) for all years between 2020–2024.

Extracts:

Urban mask
Non-urban mask
Bare ground exclusion

Creates a clean rural reference mask by buffering 30 km around the ROI.

 3. Urban Heat Island Computation

Loads Landsat 8 Collection 2 Level-2 surface temperature band.

Converts thermal band to Celsius.

Computes:

Mean Urban LST

Mean Rural LST

UHI Intensity = Urban – Rural

Generates a spatial UHI image for each target year.

 4. Yearly UHI Summary Output

The script prints:

Years processed
Mean Urban temperature
Mean Rural temperature
UHI intensity values

 5. UHI Visualization

Generates color-coded UHI maps using:
palette: ['blue', 'white', 'red']
Blue = Cooler than rural
Red = Hotter than rural

 6. Exporting Results

Exports:

UHI 2020 RGB image

UHI 2024 raw UHI raster

To Google Drive (EarthEngineExports folder).
