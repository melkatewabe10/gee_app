Quick Guide — Taoyuan City Thermal Environmental Monitoring App

A Google Earth Engine app for monitoring urban thermal conditions in Taoyuan City using six MODIS-based indices: LST, SUHI, NDVI, NDBI, RSETI, SWATI (2001–present).

1. Generate the maps
Date Range — choose the start and end year.
Season — All Seasons, Winter, Spring, Summer, or Fall.
Analysis Unit — Village (default) or District. The boundary of the chosen unit appears on the map immediately.
Indices — tick the indices you want.
Click ▶ APPLY ANALYSIS. Each index is shown as a choropleth map, where every village/district is coloured by its mean value. Use the map's Layers button to switch between indices.
2. Extract a time series
Click an admin in the map — the village/district is identified by name and highlighted in yellow.
Check indices to include.
Set date range (e.g. 2016–2025 gives 10 annual values).
Click ▶ DATA EXTRACT.

The STATISTICS: TIME SERIES ANALYSIS RESULT section then shows, for the selected unit: one trend chart per index (annual seasonal median, linear trendline), an annual values table, and a summary table (Median, Mean, Max, Min, StdDev, Count).

3. Export

At the bottom of the statistics section:

Export Map (GeoTIFF) — download link for the LST composite map.
Export Time Series (CSV) — download link for the annual values of the selected village/district.
Tips
The Description & Reference panel (right side) shows the formula, reference, and colour scale of each index — click an index checkbox to update it.
If some years fail on long date ranges, click DATA EXTRACT again (retries usually succeed) or uncheck RSETI/SWATI, the heaviest indices.
✕ Clear Selection removes the selected unit; ↺ Reset restores all defaults.

Date: July 2026

 The app link: https://ee-tewabe60.projects.earthengine.app/view/ttem
