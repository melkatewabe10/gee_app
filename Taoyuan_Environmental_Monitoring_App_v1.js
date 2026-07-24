/*
Title: Urban Thermal Environment Monitoring of Taoyuan City Using Remote Sensing Indices

Description:
A Google Earth Engine framework integrating LST, NDVI, NDBI, SUHI, RSETI, and SWATI
for monitoring urban thermal conditions and environmental changes.

Author: Tewabe Melkamu
TIGP - Earth System Science (ESS), PhD Student
*/

// ============================================================================
// TAOYUAN ENVIRONMENTAL MONITORING APP v1.0 · ADMIN-UNIT EDITION
// Google Earth Engine · Code Editor (JavaScript API)
// ============================================================================
// v8.x: see Taoyuan_Environmental_Monitoring_App_v8.9.js for full log.
// ============================================================================
// v9.2 CHANGES (vs v9.1):
//  44. ANALYSIS UNIT selector added to the Control Panel: VILLAGE (default,
//      'projects/ee-tewabe60/assets/Village_name', attribute VILLENG) or
//      DISTRICT ('projects/ee-tewabe60/assets/Fdistrict'). Choropleth maps,
//      click-to-inspect, time-series extraction, and exports all follow the
//      selected unit.
//  45. The BOUNDARY of the selected analysis unit is drawn on the map
//      immediately when the unit is chosen (before APPLY ANALYSIS), and the
//      clicked village/district is highlighted in yellow.
//  46. Inspector instructions updated: 1) Click a admin in the map
//      2) Check indices  3) Set date range  4) Click DATA EXTRACT.
//  47. Description & Reference panel rewritten with the full index
//      documentation (LST / SUHI / NDVI / NDBI / RSETI / SWATI) including
//      updated references (Rao 1972; Rouse et al. 1974; Zha et al. 2003;
//      Liou et al. 2019; Liou & Thai 2025; Liou et al. 2023).
//  48. Panel titles updated: map = 'MAP — TAOYUAN CITY THERMAL ENVIRONMENTAL
//      MONITORING'; statistics = 'STATISTICS: TIME SERIES ANALYSIS RESULT'.
//      Stats captions simplified; export section renamed
//      'Export (download links)' with buttons 'Export Map (GeoTIFF)' and
//      'Export Time Series (CSV)'.
// ============================================================================
// v9.1 CHANGES (vs v9.0):
//  43. Village reduction switched from MEAN to MEDIAN everywhere:
//      • choropleth maps (reduceRegions with ee.Reducer.median()),
//      • annual time-series extraction (reduceRegion with median),
//      • all labels / captions updated accordingly.
//      The median is more robust to residual cloud-contaminated or edge
//      pixels inside a village polygon. NOTE: the "Mean" column in the
//      SUMMARY table is unchanged — that is the TEMPORAL mean of the annual
//      village-median values across years, a different statistic.
// ============================================================================
// v9.0 CHANGES (vs v8.9):
//  37. Boundary asset switched from Fdistrict to the VILLAGE shapefile
//      'projects/ee-tewabe60/assets/Village_name' (name attribute: VILLENG).
//  38. APPLY ANALYSIS now reduces every index to its MEDIAN PER VILLAGE
//      (one reduceRegions over the 6-band stack) and displays VILLAGE-LEVEL
//      CHOROPLETH maps (each village painted by its median value; colour
//      stretch = 2–98 percentile across the village medians).
//  39. Pixel Inspector replaced by a VILLAGE INSPECTOR: click any village →
//      the app identifies it via VILLENG, highlights it, and EXTRACT builds
//      the YEAR-BY-YEAR annual seasonal mean series of that whole village
//      for every checked index (same |Z|≤3 temporal outlier filter, same
//      Google-Charts linear trendline with R²).
//  40. Summary table now reports Median / Mean / Max / Min / StdDev / Count
//      per index for the clicked village over the full selected range.
//  41. APP-SAFE EXPORTS: Export.image / Export.table tasks CANNOT be started
//      from a published EE App (Tasks only exist in the Code Editor). Both
//      export buttons now generate direct DOWNLOAD LINKS via getDownloadURL,
//      which work both in the Code Editor and in the published app.
//  42. Removed the silent try/catch fallback rectangle around the asset —
//      client-side try/catch never catches server-side permission errors,
//      it only hid the real problem ("error loading some parts of the map").
//      See the APP-PUBLISHING NOTES at the bottom: the fix is to SHARE the
//      asset with the app (or make it public).
// ============================================================================

// ============================================================================
// SECTION 1 — CONFIGURATION
// ============================================================================
var CFG = {
  villageAssetId:'projects/ee-tewabe60/assets/Village_name',
  villageProp:  'VILLENG',   // village name attribute in the shapefile
  districtAssetId:'projects/ee-tewabe60/assets/Fdistrict',
  districtProp: 'TOWNENG',   // district name attribute — ADJUST if your
                             // Fdistrict shapefile uses a different field
                             // (a fallback auto-detects the first text field)
  scale:         1000,       // MODIS 1 km grid
  statsScale:    1000,
  tileScale:     4,
  nSamples:      400,        // random pixel sample size for spatial Z-masks /
                             // normalization inside index functions (RSETI/SWATI)
  sampleSeed:    0,
  yearChunkSize: 2,          // years per server request in village extraction
                             // (kept small — each year builds a full index
                             // stack; failed chunks auto-retry year-by-year)
  NDVI_RURAL:    0.5,        // NDVI threshold for SUHI rural mask
  Z_THRESH:      3,          // |Z| threshold — spatial AND temporal filters
  LST_MIN_VALID: 10,
  LST_MAX_VALID: 65,
  LAT: 25.03, LON: 121.20, ZOOM: 10,
  START_YEAR: 2001,
  END_YEAR:   new Date().getFullYear()
};

var SEASONS = {
  'All Seasons': null,
  'Winter':[12,1,2], 'Spring':[3,4,5],
  'Summer':[6,7,8],  'Fall':[9,10,11]
};

// ── Analysis units (DEFAULT = Village) ───────────────────────────────────────
var UNITS = {
  'Village':  { assetId: CFG.villageAssetId,  nameProp: CFG.villageProp  },
  'District': { assetId: CFG.districtAssetId, nameProp: CFG.districtProp }
};
var DEFAULT_UNIT = 'Village';

// ============================================================================
// SECTION 2 — COLOUR TOKENS
// ============================================================================
var W   = '#ffffff';
var GR  = '#f4f5f7';
var BD  = '#d1d5db';
var T1  = '#111827';
var T2  = '#6b7280';
var AC  = '#1d4ed8';
var GN  = '#15803d';
var RD  = '#b91c1c';
var AM  = '#b45309';
var BLK = '#000000';
var HL  = '#ffff00';   // selected-village highlight

var PALETTES = {
  LST:  { pal:['#2c7bb6','#abd9e9','#ffffbf','#fdae61','#d7191c'], min:20, max:50, unit:'°C',
           label:'LST — Land Surface Temperature (°C)' },
  SUHI: { pal:['#fff7ec','#fee8c8','#fdd49e','#fdbb84','#fc8d59',
               '#ef6548','#d7301f','#b30000','#7f0000'], min:0, max:10, unit:'°C',
           label:'SUHI — Urban Heat Island Intensity (°C)' },
  NDVI: { pal:['#d73027','#fc8d59','#fee08b','#d9ef8b','#1a9850'], min:-0.2, max:0.8,
           unit:'index', label:'NDVI — Vegetation Index' },
  NDBI: { pal:['#30123b','#4454c4','#1f9eb5','#40be70','#c2df25',
               '#fe9b2d','#e55709','#900c00'], min:-0.5, max:0.5,
           unit:'index', label:'NDBI — Built-up Index' },
  RSETI:{ pal:['#8c510a','#d8b365','#f6e8c3','#c7eae5','#5ab4ac','#01665e'], min:0, max:1,
           unit:'index', label:'RSETI — Relative Evapotranspiration Index' },
  SWATI:{ pal:['#313695','#4575b4','#74add1','#fee090','#f46d43','#d73027'], min:0, max:1,
           unit:'index', label:'SWATI — Surface Water Availability-Temperature Index' }
};

var INFO = {
  LST:  { desc:   'The LST was derived from the MODIS MOD11A1 daily LST product (Terra, 1 km). The data quality was controlled using the QC_Day quality assurance layer to remove unreliable observations, and the filtered LST data were aggregated to the administrative level.',
           formula:'LST °C = (LST_Day_1km × 0.02) − 273.15',
           ref:    'The MOD11A1 LST product and scaling procedure follow the MOD11 LST Product User Guide, NASA LP DAAC.' },
  SUHI: { desc:   'SUHI quantifies the thermal difference between urban surfaces and surrounding rural areas. It is calculated as the difference between the LST of urban areas and a rural reference temperature, using MODIS LST product.',
           formula:'SUHI = LST − Rural baseline LST',
           ref:    'The concept of SUHI originates from satellite-based observations of urban thermal environments. Rao (1972), the first satellite-based observation of the urban heat island.' },
  NDVI: { desc:   'The NDVI was calculated from the MODIS daily surface reflectance product and aggregated to the administrative area. NDVI is a widely used indicator of vegetation greenness and health.',
           formula:'NDVI = (NIR − Red)/(NIR + Red)',
           ref:    'NDVI was introduced by Rouse et al. (1974) as a simple and effective index for monitoring vegetation using red and near-infrared reflectance.' },
  NDBI: { desc:   'The NDBI was calculated from the MODIS daily surface reflectance product and aggregated to the administrative area. It has been widely applied for urban expansion mapping, impervious surface detection, and analysis of urban environmental changes.',
           formula:'NDBI = (SWIR1 − NIR)/(SWIR1 + NIR)',
           ref:    'NDBI was introduced by Zha et al. (2003) as a remote sensing index for extracting built-up areas by exploiting the spectral contrast between SWIR and NIR reflectance.' },
  RSETI:{ desc:   'The RSETI was calculated from the Normalized Difference Latent Heat Index (NDLI) using MODIS surface reflectance bands. The resulting RSETI values were aggregated to the administrative area. RSETI represents relative surface water availability and evapotranspiration conditions, where higher values indicate greater evaporative potential and improved surface moisture conditions.',
           formula:'NDLI = (Green − Red)/(Green + Red + SWIR1) ; RSETI = (NDLI − min)/(max − min)',
           ref:    'NDLI was introduced by Liou et al. (2019) and later modified as RSETI by Liou and Thai (2025).' },
  SWATI:{ desc:   'The Surface Water Availability-Temperature Index (SWATI) is a remote sensing-based drought indicator that integrates three key environmental components: vegetation condition (NDVI), surface water availability (NDLI), and thermal stress (LST). SWATI is designed to monitor agricultural drought conditions and variations in surface moisture availability.',
           formula:'SWATI = √(((1−NDLI)² + (1−NDVI)² + LST²)/3)',
           ref:    'SWATI was introduced by Liou et al. (2023) as a satellite-based drought indicator.' }
};

// ============================================================================
// SECTION 3 — UI HELPERS
// ============================================================================
function lb(text, clr, sz, bold) {
  return ui.Label(text, {
    color: clr||T1, fontSize: sz||'11px',
    fontWeight: bold?'bold':'normal',
    margin: '1px 0px', backgroundColor: 'rgba(0,0,0,0)'
  });
}

function sh(text) {
  return ui.Panel([
    lb(text, AC, '11px', true),
    ui.Panel([], ui.Panel.Layout.flow('horizontal'), {
      backgroundColor: AC, height: '1px',
      margin: '1px 0px 4px 0px', stretch: 'horizontal'
    })
  ], ui.Panel.Layout.flow('vertical'), {backgroundColor:'rgba(0,0,0,0)', margin:'0px'});
}

function card(widgets, extra) {
  var s = {backgroundColor:W, border:'1px solid '+BD, padding:'8px', margin:'3px 0px'};
  if (extra) Object.keys(extra).forEach(function(k){ s[k]=extra[k]; });
  return ui.Panel(widgets, ui.Panel.Layout.flow('vertical'), s);
}

function hrow(widgets) {
  return ui.Panel(widgets, ui.Panel.Layout.flow('horizontal'),
    {backgroundColor:'rgba(0,0,0,0)', margin:'1px 0px'});
}

function phead(text) {
  return ui.Label(text, {
    color:W, fontSize:'11px', fontWeight:'bold',
    backgroundColor:T1, padding:'6px 10px', margin:'0px'
  });
}

function grayBtn(label) {
  return ui.Button({label:label, style:{
    color:T2, backgroundColor:BD, fontSize:'11px',
    padding:'5px 8px', margin:'3px 0px', stretch:'horizontal'
  }});
}

function makeColorBar(palInfo, mn, mx) {
  var bar = ui.Thumbnail({
    image: ee.Image.pixelLonLat().select('longitude')
              .visualize({min:0, max:1, palette:palInfo.pal}),
    params:{bbox:[0,0,1,0.1], dimensions:'180x14', format:'png'},
    style:{stretch:'horizontal', margin:'2px 0px', height:'16px'}
  });
  var mnS = (mn!==undefined&&mn!==null) ? Number(mn).toFixed(2) : String(palInfo.min);
  var mxS = (mx!==undefined&&mx!==null) ? Number(mx).toFixed(2) : String(palInfo.max);
  return ui.Panel([
    bar,
    hrow([lb(mnS, BLK,'9px'),
          ui.Label('',{stretch:'horizontal',backgroundColor:'rgba(0,0,0,0)'}),
          lb(mxS, BLK,'9px')])
  ], ui.Panel.Layout.flow('vertical'), {backgroundColor:'rgba(0,0,0,0)',margin:'2px 0px'});
}

// ============================================================================
// SECTION 4 — FULL QUALITY MASKING (MODIS bit-level QA)
// ============================================================================
function maskMOD11A1(img) {
  var qc = img.select('QC_Day');
  return img.updateMask(qc.bitwiseAnd(3).lte(1)
                          .and(qc.rightShift(6).bitwiseAnd(3).lte(1)));
}

function maskMOD09GA(img) {
  var st = img.select('state_1km');
  return img.updateMask(
    st.bitwiseAnd(3).eq(0)
      .and(st.rightShift(2).bitwiseAnd(1).eq(0))
      .and(st.rightShift(8).bitwiseAnd(3).eq(0))
      .and(st.rightShift(10).bitwiseAnd(1).eq(0))
      .and(st.rightShift(11).bitwiseAnd(1).eq(0))
      .and(st.rightShift(12).bitwiseAnd(1).eq(0))
      .and(st.rightShift(13).bitwiseAnd(1).eq(0))
  );
}

// ============================================================================
// SECTION 5 — DATA LOADING
// ============================================================================
function getUnitName()  { return selUnit ? selUnit.getValue() : DEFAULT_UNIT; }
function getUnits()     { return ee.FeatureCollection(UNITS[getUnitName()].assetId); }
function getUnitProp()  { return UNITS[getUnitName()].nameProp; }

function applySeasonFilter(col, season) {
  if (season && SEASONS[season]) {
    col = col.map(function(img){
      return img.set('month', ee.Date(img.get('system:time_start')).get('month'));
    }).filter(ee.Filter.inList('month', SEASONS[season]));
  }
  return col;
}

function loadMOD11A1(aoi, start, end, season) {
  return applySeasonFilter(
    ee.ImageCollection('MODIS/061/MOD11A1').filterBounds(aoi).filterDate(start,end).map(maskMOD11A1),
    season
  );
}

function loadMOD09GA(aoi, start, end, season) {
  return applySeasonFilter(
    ee.ImageCollection('MODIS/061/MOD09GA').filterBounds(aoi).filterDate(start,end).map(maskMOD09GA),
    season
  );
}

// ============================================================================
// SECTION 6 — PIXEL-SAMPLING STAT HELPERS (for spatial index computation)
// ============================================================================
function sampleImage(image, bands, aoi) {
  return image.select(bands).sample({
    region:aoi, scale:CFG.statsScale, numPixels:CFG.nSamples,
    seed:CFG.sampleSeed, tileScale:CFG.tileScale, dropNulls:true, geometries:false
  });
}

function colStats(sample, band, reducer) {
  return sample.reduceColumns({reducer:reducer, selectors:[band]});
}

function zMaskFromSample(image, band, sample) {
  var stats = colStats(sample, band, ee.Reducer.mean().combine(ee.Reducer.stdDev(),null,true));
  var mn = ee.Image.constant(ee.Number(ee.Algorithms.If(stats.get('mean'),   stats.get('mean'),   0)));
  var sd = ee.Image.constant(ee.Number(ee.Algorithms.If(stats.get('stdDev'),stats.get('stdDev'),1)));
  var z  = image.select(band).subtract(mn).divide(sd.max(1e-6));
  return image.select(band).updateMask(z.abs().lte(CFG.Z_THRESH));
}

function zMaskBand(image, band, aoi) {
  return zMaskFromSample(image, band, sampleImage(image,[band],aoi));
}

function normFromSample(image, band, sample) {
  var stats = colStats(sample, band, ee.Reducer.minMax());
  var bMin = ee.Image.constant(ee.Number(ee.Algorithms.If(stats.get('min'),stats.get('min'),0)));
  var bMax = ee.Image.constant(ee.Number(ee.Algorithms.If(stats.get('max'),stats.get('max'),1)));
  return image.subtract(bMin).divide(bMax.subtract(bMin).max(1e-6)).clamp(0,1);
}

// ============================================================================
// SECTION 7 — LST & SURFACE-REFLECTANCE COMPOSITES
// ============================================================================
function scaleLST(img) {
  var lst = img.select('LST_Day_1km').multiply(0.02).add(-273.15).rename('LST_C');
  return lst.updateMask(lst.gte(CFG.LST_MIN_VALID).and(lst.lte(CFG.LST_MAX_VALID)));
}

function computeLSTComposite(col, aoi) {
  return col.map(scaleLST).median().rename('LST_C').clip(aoi);
}

var MODIS_1KM_PROJ  = ee.ImageCollection('MODIS/061/MOD11A1').first().select('LST_Day_1km').projection();
var MODIS_500M_PROJ = ee.ImageCollection('MODIS/061/MOD09GA').first().select('sur_refl_b01').projection();
var SR_BANDS = ['sur_refl_b01','sur_refl_b02','sur_refl_b03','sur_refl_b04','sur_refl_b05'];

function scaleSR(img) { return img.select(SR_BANDS).multiply(0.0001); }

function resampleTo1km(image) {
  return image
    .setDefaultProjection(MODIS_500M_PROJ)
    .reduceResolution({reducer:ee.Reducer.mean(), maxPixels:64})
    .reproject({crs:MODIS_1KM_PROJ});
}

function computeComposite(col, aoi) {
  return resampleTo1km(col.map(scaleSR).median().clip(aoi)).clip(aoi);
}

// ============================================================================
// SECTION 8 — INDEX FUNCTIONS
// (MOD09GA bands: b01=Red, b02=NIR, b03=Blue, b04=Green, b05=SWIR1)
// ============================================================================
function computeNDVI(composite, aoi) {
  return composite.normalizedDifference(['sur_refl_b02','sur_refl_b01']).rename('NDVI').clip(aoi);
}

function computeNDBI(composite, aoi) {
  return composite.normalizedDifference(['sur_refl_b05','sur_refl_b02']).rename('NDBI').clip(aoi);
}

function computeSUHI(composite, lstImg, aoi) {
  var ndvi      = composite.normalizedDifference(['sur_refl_b02','sur_refl_b01']);
  var ruralLST  = lstImg.updateMask(ndvi.gt(CFG.NDVI_RURAL)).rename('LST_C');
  var stats = ruralLST.reduceRegion({
    reducer:ee.Reducer.median(), geometry:aoi, scale:CFG.statsScale,
    maxPixels:1e9, bestEffort:true, tileScale:CFG.tileScale
  });
  var lstRural = ee.Number(ee.Algorithms.If(stats.get('LST_C'),stats.get('LST_C'),0));
  return lstImg.subtract(ee.Image.constant(lstRural)).rename('SUHI').max(0).clip(aoi);
}

function computeRSETI(composite, aoi) {
  var ndliRaw = composite.select('sur_refl_b04').subtract(composite.select('sur_refl_b01'))
    .divide(composite.select('sur_refl_b04').add(composite.select('sur_refl_b01'))
                                            .add(composite.select('sur_refl_b05')))
    .rename('NDLI').clamp(-1,1);
  var ndliMask = zMaskBand(ndliRaw,'NDLI',aoi);
  var mmSample = sampleImage(ndliMask,['NDLI'],aoi);
  var mmStats  = colStats(mmSample,'NDLI',ee.Reducer.minMax());
  var mn = ee.Number(ee.Algorithms.If(mmStats.get('min'),mmStats.get('min'),0));
  var mx = ee.Number(ee.Algorithms.If(mmStats.get('max'),mmStats.get('max'),1));
  return ndliMask.subtract(mn).divide(ee.Number(mx).subtract(mn).max(1e-6))
    .rename('RSETI').clamp(0,1).clip(aoi);
}

function computeSWATI(composite, lstImg, aoi) {
  var ndviRaw = composite.normalizedDifference(['sur_refl_b02','sur_refl_b01']).rename('NDVI');
  var ndliRaw = composite.select('sur_refl_b04').subtract(composite.select('sur_refl_b01'))
    .divide(composite.select('sur_refl_b04').add(composite.select('sur_refl_b01'))
                                            .add(composite.select('sur_refl_b05'))).rename('NDLI');
  var lstRaw  = lstImg.rename('LST_C');
  var stack   = ndviRaw.addBands([ndliRaw, lstRaw]);

  var zSample    = sampleImage(stack,['NDVI','NDLI','LST_C'],aoi);
  var ndviM = zMaskFromSample(stack,'NDVI', zSample);
  var ndliM = zMaskFromSample(stack,'NDLI', zSample);
  var lstM  = zMaskFromSample(stack,'LST_C',zSample);

  var normStack  = ndviM.rename('NDVI_z').addBands(ndliM.rename('NDLI_z')).addBands(lstM.rename('LST_z'));
  var normSample = sampleImage(normStack,['NDVI_z','NDLI_z','LST_z'],aoi);
  var ndviN = normFromSample(ndviM,'NDVI_z',normSample);
  var ndliN = normFromSample(ndliM,'NDLI_z',normSample);
  var lstN  = normFromSample(lstM, 'LST_z', normSample);

  return ee.Image(1).subtract(ndliN).pow(2)
    .add(ee.Image(1).subtract(ndviN).pow(2))
    .add(lstN.pow(2)).divide(3).sqrt()
    .rename('SWATI').clamp(0,1).clip(aoi);
}

// ── Annual composite stack (all 6 indices) — reused by the village maps AND
//    the village time-series extraction. Indices are computed over the WHOLE
//    study area (so SUHI baseline and RSETI/SWATI normalization stay
//    consistent), then reduced per village afterwards.
function computeIndexStack(lstCol, srCol, aoi) {
  var lstImg    = computeLSTComposite(lstCol, aoi).rename('LST');
  var composite = computeComposite(srCol, aoi);
  var ndviImg  = computeNDVI (composite,aoi).rename('NDVI');
  var ndbiImg  = computeNDBI (composite,aoi).rename('NDBI');
  var rsetiImg = computeRSETI(composite,aoi).rename('RSETI');
  var suhiImg  = computeSUHI (composite, lstImg.rename('LST_C'), aoi).rename('SUHI');
  var swatiImg = computeSWATI(composite, lstImg.rename('LST_C'), aoi).rename('SWATI');
  return lstImg.addBands([suhiImg, ndviImg, ndbiImg, rsetiImg, swatiImg]);
}

// ── Selected-keys-only stack — used by the Village Inspector extraction.
//    Computing only the CHECKED indices per year is a huge cost saving:
//    RSETI and SWATI each run several AOI-wide sampling passes, and skipping
//    them (when unchecked) is often the difference between a chunk finishing
//    and timing out with "computation timed out / user memory limit exceeded".
function computeIndexStackForKeys(lstCol, srCol, aoi, keys) {
  var needLST = keys.indexOf('LST')>=0 || keys.indexOf('SUHI')>=0 || keys.indexOf('SWATI')>=0;
  var needSR  = ['NDVI','NDBI','RSETI','SWATI','SUHI'].some(function(k){
    return keys.indexOf(k)>=0;
  });
  var lstImg    = needLST ? computeLSTComposite(lstCol, aoi).rename('LST') : null;
  var composite = needSR  ? computeComposite(srCol, aoi) : null;

  var bands = [];
  keys.forEach(function(k){
    if(k==='LST')   bands.push(lstImg);
    if(k==='NDVI')  bands.push(computeNDVI (composite,aoi).rename('NDVI'));
    if(k==='NDBI')  bands.push(computeNDBI (composite,aoi).rename('NDBI'));
    if(k==='RSETI') bands.push(computeRSETI(composite,aoi).rename('RSETI'));
    if(k==='SUHI')  bands.push(computeSUHI (composite, lstImg.rename('LST_C'), aoi).rename('SUHI'));
    if(k==='SWATI') bands.push(computeSWATI(composite, lstImg.rename('LST_C'), aoi).rename('SWATI'));
  });
  var img = bands[0];
  for(var i=1;i<bands.length;i++) img = img.addBands(bands[i]);
  return img;
}

// ============================================================================
// SECTION 9 — VILLAGE-MEAN REDUCTION + CHOROPLETH PAINTING
// ============================================================================
// One reduceRegions over the 6-band stack: each village Feature gains six
// properties named after the bands (LST, SUHI, NDVI, NDBI, RSETI, SWATI).
function reduceStackToVillages(stack, villages) {
  return stack.reduceRegions({
    collection: villages,
    reducer:    ee.Reducer.median(),
    scale:      CFG.statsScale,
    tileScale:  CFG.tileScale
  });
}

// Paint villages by a numeric property → choropleth image.
function paintVillagesBy(fc, prop) {
  return ee.Image().float().paint(fc.filter(ee.Filter.notNull([prop])), prop);
}

// 2–98 percentile of the village medians for one index (evaluated client-side).
function getVillageP298(fc, prop, callback) {
  fc.filter(ee.Filter.notNull([prop]))
    .reduceColumns({reducer: ee.Reducer.percentile([2,98]), selectors:[prop]})
    .evaluate(function(v){ callback(v?v.p2:null, v?v.p98:null); });
}

// ============================================================================
// SECTION 10 — MAP
// ============================================================================
var MAP = ui.Map();
MAP.setCenter(CFG.LON, CFG.LAT, CFG.ZOOM);
MAP.setOptions('HYBRID');

// ============================================================================
// SECTION 11 — LEFT PANEL (Control)
// ============================================================================
var yrs = (function(){
  var a=[]; for(var i=CFG.START_YEAR;i<=CFG.END_YEAR;i++) a.push(String(i)); return a;
})();

var selStart = ui.Select({items:yrs, value:'2001',
  style:{color:T1,backgroundColor:W,fontSize:'11px',width:'85px'}});
var selEnd   = ui.Select({items:yrs, value:String(CFG.END_YEAR),
  style:{color:T1,backgroundColor:W,fontSize:'11px',width:'85px'}});
var dateCard = card([sh('📅  Date Range'),
  hrow([lb('From:',T2,'10px'), selStart]),
  hrow([lb('To:',  T2,'10px'), selEnd  ])]);

var selSeason = ui.Select({items:Object.keys(SEASONS), value:'All Seasons',
  style:{color:T1,backgroundColor:W,fontSize:'11px',stretch:'horizontal'}});
var seasonCard = card([sh('🌤  Season'), selSeason]);

// ── Analysis Unit selector (Village = default, or District) ──────────────────
var selUnit = ui.Select({items:Object.keys(UNITS), value:DEFAULT_UNIT,
  style:{color:T1,backgroundColor:W,fontSize:'11px',stretch:'horizontal'}});
var unitCard = card([sh('🗂  Analysis Unit'), selUnit,
  lb('Choropleth maps, click-inspection and export follow this unit.', T2,'9px')]);
selUnit.onChange(function(u){
  // Clear any previously selected feature — it belongs to the old unit
  clearSelectedAdmin();
  // Draw the boundary of the newly selected unit immediately
  showUnitBoundary();
  setStatus('Analysis unit: ' + u + ' — click APPLY ANALYSIS to redraw the maps', T2);
});

function mkCk(t){ return ui.Checkbox({label:t, value:true,
  style:{color:T1,fontSize:'11px',margin:'2px 0px',backgroundColor:'rgba(0,0,0,0)'}}); }
var ckLST   = mkCk('LST');
var ckSUHI  = mkCk('SUHI');
var ckNDVI  = mkCk('NDVI');
var ckNDBI  = mkCk('NDBI');
var ckRSETI = mkCk('RSETI');
var ckSWATI = mkCk('SWATI');
var idxCard = card([sh('📊  Indices'),ckLST,ckSUHI,ckNDVI,ckNDBI,ckRSETI,ckSWATI]);

// ── Admin Inspector controls ─────────────────────────────────────────────────
var ptCoordLbl   = lb('No admin unit selected — click the map', T2,'10px');
var btnPtExtract = ui.Button({label:'▶  DATA EXTRACT', style:{
  color:BLK, backgroundColor:W, fontSize:'11px', fontWeight:'bold',
  padding:'6px 10px', margin:'3px 0px', stretch:'horizontal', border:'1px solid '+BD
}});
var btnPtClear   = grayBtn('✕  Clear Selection');
var ptStatusLbl  = lb('', T2,'10px');
var ptCard = card([
  sh('🏘  Admin Inspector'),
  lb('1) Click a admin in the map  2) Check indices  3) Set date range  4) Click DATA EXTRACT', T2,'9px'),
  ptCoordLbl, btnPtExtract, btnPtClear, ptStatusLbl
]);

var ctrlWidth = ui.Slider({min:160,max:380,value:215,step:5,
  style:{stretch:'horizontal',margin:'2px 0px'}});
ctrlWidth.onSlide(function(v){ leftPanel.style().set('width', v+'px'); });
var widthCard = card([sh('↔  Panel Width'), ctrlWidth]);

var btnApply = ui.Button({label:'▶  APPLY ANALYSIS', style:{
  color:BLK, backgroundColor:W, fontSize:'12px', fontWeight:'bold',
  padding:'8px 12px', margin:'3px 0px', stretch:'horizontal', border:'1px solid '+BD
}});
var btnReset  = grayBtn('↺  Reset');
var statusLbl = lb('Ready — click APPLY ANALYSIS', T2,'10px');
var btnCard   = card([btnApply, btnReset, statusLbl]);

var leftInner = ui.Panel(
  [dateCard, seasonCard, unitCard, idxCard, ptCard, widthCard, btnCard],
  ui.Panel.Layout.flow('vertical'), {padding:'6px', backgroundColor:GR}
);
var leftPanel = ui.Panel(
  [phead('CONTROL PANEL'), leftInner],
  ui.Panel.Layout.flow('vertical'),
  {width:'215px', backgroundColor:GR, border:'1px solid '+BD}
);

// ============================================================================
// SECTION 12 — RIGHT PANEL (Description + Colour Bar)
// ============================================================================
var descTitle  = lb('—', AC,'12px',true);
var descBody   = lb('Click a checkbox to see index details.', T2,'10px');
var descFLbl   = lb('Formula:', T2,'10px',true);
var descForm   = lb('—', T1,'10px');
var descRLbl   = lb('Reference:', T2,'10px',true);
var descRef    = lb('—', T2,'10px');
var descCBSlot = ui.Panel([],ui.Panel.Layout.flow('vertical'),
  {backgroundColor:'rgba(0,0,0,0)',margin:'4px 0px'});

var descCard = card([sh('SELECTED INDEX'),
  descTitle, descBody, descFLbl, descForm, descRLbl, descRef,
  lb('Colour Scale (2–98 pctile of village medians):',BLK,'10px',true), descCBSlot]);

function updateDescPanel(key, mn, mx) {
  var info=INFO[key]; var pal=PALETTES[key];
  if(!info||!pal) return;
  descTitle.setValue(pal.label); descBody.setValue(info.desc);
  descForm.setValue(info.formula); descRef.setValue(info.ref);
  descCBSlot.clear(); descCBSlot.add(makeColorBar(pal,mn,mx));
}
function wireCheck(ck,key){ ck.onChange(function(v){ if(v) updateDescPanel(key); }); }
wireCheck(ckLST,'LST'); wireCheck(ckSUHI,'SUHI'); wireCheck(ckNDVI,'NDVI');
wireCheck(ckNDBI,'NDBI'); wireCheck(ckRSETI,'RSETI'); wireCheck(ckSWATI,'SWATI');
updateDescPanel('LST');

var rightWidth = ui.Slider({min:180,max:380,value:235,step:5,
  style:{stretch:'horizontal',margin:'2px 0px'}});
rightWidth.onSlide(function(v){ rightPanel.style().set('width', v+'px'); });
var rightWidthCard = card([sh('↔  Panel Width'), rightWidth]);

var rightInner = ui.Panel(
  [descCard, rightWidthCard],
  ui.Panel.Layout.flow('vertical'), {padding:'6px', backgroundColor:GR}
);
var rightPanel = ui.Panel(
  [phead('DESCRIPTION & REFERENCE'), rightInner],
  ui.Panel.Layout.flow('vertical'),
  {width:'235px', backgroundColor:GR, border:'1px solid '+BD}
);

// ============================================================================
// SECTION 13 — CENTRE PANEL
// ============================================================================
var mapPanel = ui.Panel(
  [phead('MAP — TAOYUAN CITY THERMAL ENVIRONMENTAL MONITORING'), MAP],
  ui.Panel.Layout.flow('vertical'),
  {stretch:'both', border:'1px solid '+BD, margin:'0px 0px 2px 0px'}
);

var mapHeightSlider = ui.Slider({min:200, max:700, value:400, step:10,
  style:{stretch:'horizontal', margin:'2px 0px'}});
mapHeightSlider.onSlide(function(v){ MAP.style().set('height', v+'px'); });
var mapResizeCard = card([sh('↕  Map Height'), mapHeightSlider]);

// ── Admin Inspector output panels ───────────────────────────────────────────
var INIT_CHART_MSG   = '🏘 Click a village/district on the map and press  ▶ DATA EXTRACT  to generate one chart per selected index (annual seasonal MEDIAN of the unit · |Z|≤' + CFG.Z_THRESH + ' filtered).';
var INIT_YEARTBL_MSG = '🏘 Annual values table (Year vs median value, one row per year of the selected range) will appear here after extraction.';
var INIT_TABLE_MSG   = '🏘 Summary statistics (Median / Mean / Max / Min / StdDev / Count) will appear here after extraction.';

var pPointCharts = ui.Panel(
  [card([lb(INIT_CHART_MSG, T2,'10px')])],
  ui.Panel.Layout.flow('vertical'),
  {backgroundColor:GR, margin:'2px 0px'}
);
var pYearTable = ui.Panel(
  [card([lb(INIT_YEARTBL_MSG, T2,'10px')])],
  ui.Panel.Layout.flow('vertical'),
  {backgroundColor:GR, margin:'2px 0px'}
);
var pPointTable = ui.Panel(
  [card([lb(INIT_TABLE_MSG, T2,'10px')])],
  ui.Panel.Layout.flow('vertical'),
  {backgroundColor:GR, margin:'2px 0px'}
);

// ── Export buttons + download-link slot (bottom of centre panel) ─────────────
var btnExMap  = ui.Button({label:'Export Map (GeoTIFF)', style:{
  color:BLK, backgroundColor:W, fontSize:'11px', fontWeight:'bold',
  padding:'6px 10px', margin:'3px 0px', stretch:'horizontal', border:'1px solid '+BD
}});
var btnExData = ui.Button({label:'Export Time Series (CSV)', style:{
  color:BLK, backgroundColor:W, fontSize:'11px', fontWeight:'bold',
  padding:'6px 10px', margin:'3px 0px', stretch:'horizontal', border:'1px solid '+BD
}});
var exportLinkSlot = ui.Panel([], ui.Panel.Layout.flow('vertical'),
  {backgroundColor:'rgba(0,0,0,0)', margin:'2px 0px'});
var exportCard = card([sh('💾  Export (download links)'),
  hrow([btnExMap, btnExData]), exportLinkSlot]);

var inspectorPanel = ui.Panel(
  [phead('STATISTICS: TIME SERIES ANALYSIS RESULT'),
   ui.Panel([mapResizeCard, pPointCharts, pYearTable, pPointTable, exportCard],
     ui.Panel.Layout.flow('vertical'), {padding:'6px', backgroundColor:GR})
  ],
  ui.Panel.Layout.flow('vertical'),
  {border:'1px solid '+BD, backgroundColor:GR}
);

var centrePanel = ui.Panel(
  [mapPanel, inspectorPanel],
  ui.Panel.Layout.flow('vertical'),
  {stretch:'both', backgroundColor:GR}
);

// ============================================================================
// SECTION 14 — ROOT
// ============================================================================
ui.root.clear();
ui.root.setLayout(ui.Panel.Layout.flow('horizontal'));
ui.root.add(leftPanel);
ui.root.add(centrePanel);
ui.root.add(rightPanel);

// ============================================================================
// SECTION 15 — ANALYSIS ENGINE (admin-unit median choropleth layers)
// ============================================================================
var _lstImg = null, _aoi = null, _unitStatsFC = null, _unitBoundaryLayer = null;

function setStatus(msg,clr){ statusLbl.setValue(msg); statusLbl.style().set('color',clr||T2); }

// Draw / refresh the boundary of the currently selected analysis unit.
// Called on unit selection (before APPLY) and inside runAnalysis.
function showUnitBoundary() {
  if(_unitBoundaryLayer) MAP.layers().remove(_unitBoundaryLayer);
  _unitBoundaryLayer = ui.Map.Layer(
    ee.Image().paint(getUnits(),0,1),
    {palette:['#222222']}, getUnitName()+' Boundaries', true
  );
  MAP.layers().add(_unitBoundaryLayer);
}

function runAnalysis() {
  setStatus('⏳ Starting …', AM);
  MAP.layers().reset();
  _villageHL = null;         // highlight layer was removed by reset()
  _unitBoundaryLayer = null; // boundary layer was removed by reset()

  var sy = selStart.getValue(), ey = selEnd.getValue();
  if (parseInt(sy)>parseInt(ey)){ setStatus('⚠ Start year > end year',RD); return; }
  var season   = selSeason.getValue();
  var unitName = getUnitName();

  var units = getUnits();
  var aoi   = units.geometry();
  _aoi = aoi;

  setStatus('⏳ Loading MODIS collections …', AM);
  var lstCol = loadMOD11A1(aoi, sy+'-01-01', ey+'-12-31', season);
  var srCol  = loadMOD09GA(aoi, sy+'-01-01', ey+'-12-31', season);

  setStatus('⏳ Computing index stack …', AM);
  var stack = computeIndexStack(lstCol, srCol, aoi);
  _lstImg = stack.select('LST').rename('LST_C');

  setStatus('⏳ Reducing indices to '+unitName.toLowerCase()+' medians …', AM);
  var unitStats = reduceStackToVillages(stack, units);
  _unitStatsFC = unitStats;

  var CHK = {LST:ckLST,SUHI:ckSUHI,NDVI:ckNDVI,NDBI:ckNDBI,RSETI:ckRSETI,SWATI:ckSWATI};

  // Base layers
  MAP.addLayer(
    computeComposite(srCol, aoi),
    {bands:['sur_refl_b01','sur_refl_b04','sur_refl_b03'],min:0,max:0.3,gamma:1.4},
    'MODIS RGB', false);
  showUnitBoundary();

  setStatus('⏳ Adding '+unitName.toLowerCase()+' choropleth layers …', AM);
  var layerOrder = ['SWATI','RSETI','NDBI','NDVI','SUHI','LST'];
  var queue = layerOrder.slice();

  function addNextLayer() {
    if (!queue.length) {
      setStatus('✓ '+unitName+' maps ready — click a '+unitName.toLowerCase()+', then DATA EXTRACT', GN);
      return;
    }
    var key = queue.shift();
    getVillageP298(unitStats, key, function(p2,p98) {
      var mn = (p2!==null)  ? p2  : PALETTES[key].min;
      var mx = (p98!==null) ? p98 : PALETTES[key].max;
      if (CHK[key].getValue()) {
        MAP.addLayer(paintVillagesBy(unitStats, key),
          {min:mn,max:mx,palette:PALETTES[key].pal}, key+'', true, 0.85);
        updateDescPanel(key, mn, mx);
      }
      addNextLayer();
    });
  }
  addNextLayer();
  MAP.centerObject(aoi, CFG.ZOOM);
}

// ============================================================================
// SECTION 16 — ADMIN INSPECTOR: ANNUAL MEDIAN SERIES FOR CLICKED UNIT
// ============================================================================
var STAT_LABELS = { LST:'LST (°C)', SUHI:'SUHI (°C)', NDVI:'NDVI',
                    NDBI:'NDBI', RSETI:'RSETI', SWATI:'SWATI' };
var STAT_COLORS = { LST:'#d7191c', SUHI:'#d7301f', NDVI:'#1a9850',
                    NDBI:'#30123b', RSETI:'#01665e', SWATI:'#313695' };
var ALL_INDEX_KEYS = ['LST','SUHI','NDVI','NDBI','RSETI','SWATI'];

function getSelectedIndexKeys() {
  var ckMap = {LST:ckLST,SUHI:ckSUHI,NDVI:ckNDVI,NDBI:ckNDBI,RSETI:ckRSETI,SWATI:ckSWATI};
  return ALL_INDEX_KEYS.filter(function(k){ return ckMap[k].getValue(); });
}

function buildYearChunks(sy, ey, chunkSize) {
  var s=parseInt(sy,10), e=parseInt(ey,10), chunks=[];
  while(s<=e){ var end=Math.min(s+chunkSize-1,e); chunks.push([s,end]); s=end+1; }
  return chunks;
}

// ── Client-side math helpers ─────────────────────────────────────────────────
function jsMean(arr) {
  if(!arr.length) return null;
  var s=0; arr.forEach(function(v){s+=v;}); return s/arr.length;
}
function jsStdDev(arr) {
  if(arr.length<2) return null;
  var m=jsMean(arr), ssq=0;
  arr.forEach(function(v){ssq+=(v-m)*(v-m);});
  return Math.sqrt(ssq/(arr.length-1));
}
function jsMedian(arr) {
  if(!arr.length) return null;
  var s=arr.slice().sort(function(a,b){return a-b;}), n=s.length, mid=Math.floor(n/2);
  return (n%2) ? s[mid] : (s[mid-1]+s[mid])/2;
}
function jsMin(arr){ if(!arr.length) return null; var m=arr[0]; arr.forEach(function(v){if(v<m)m=v;}); return m; }
function jsMax(arr){ if(!arr.length) return null; var m=arr[0]; arr.forEach(function(v){if(v>m)m=v;}); return m; }

function zFilterYearSeries(pairs) {
  if(pairs.length<2) return pairs;
  var vals=pairs.map(function(r){return r.v;}), m=jsMean(vals), sd=jsStdDev(vals);
  if(m===null||sd===null||sd<1e-9) return pairs;
  return pairs.filter(function(r){ return Math.abs((r.v-m)/sd)<=CFG.Z_THRESH; });
}

// ── State ────────────────────────────────────────────────────────────────────
var _villageGeom          = null;  // ee.Geometry of the selected village
var _villageName          = null;  // JS string (VILLENG)
var _villageHL            = null;  // highlight ui.Map.Layer
var _villageAnnualFeatures = null; // raw [{year,nImages,LST,…}] for CSV export

// ── Server-side: annual composite stack → MEAN over the village polygon ──────
// Only the SELECTED indices are computed (see computeIndexStackForKeys).
function buildVillageAnnualStatsFC(villageGeom, aoi, sy, ey, season, keys) {
  var years = ee.List.sequence(parseInt(sy,10), parseInt(ey,10));

  var yearInfo = ee.FeatureCollection(years.map(function(y){
    y = ee.Number(y);
    var s = ee.Date.fromYMD(y,1,1), e = s.advance(1,'year');
    return ee.Feature(null, {year:y, nImages:loadMOD11A1(aoi,s,e,season).size()});
  })).filter(ee.Filter.gt('nImages',0));

  return yearInfo.map(function(f){
    var y    = ee.Number(f.get('year'));
    var s    = ee.Date.fromYMD(y,1,1), e = s.advance(1,'year');
    var nImg = f.get('nImages');
    var stack = computeIndexStackForKeys(
      loadMOD11A1(aoi,s,e,season),
      loadMOD09GA(aoi,s,e,season),
      aoi, keys
    );
    // Median over the village polygon — small region, cheap reduction
    var vals = stack.reduceRegion({
      reducer:   ee.Reducer.median(),
      geometry:  villageGeom,
      scale:     CFG.statsScale,
      tileScale: CFG.tileScale,
      bestEffort:true,
      maxPixels: 1e9
    });
    var props = {year:y, nImages:nImg};
    keys.forEach(function(b){ props[b] = vals.get(b); });
    return ee.Feature(null, props);
  });
}

// ── Client-side chunked orchestration with ERROR HANDLING ────────────────────
// Previously a failed chunk (timeout / memory limit) was silently skipped,
// so all its years showed up as '—'. Now:
//   • every evaluate() error is caught,
//   • a failed multi-year chunk is split into SINGLE-YEAR retries,
//   • a year that still fails on its own is recorded and REPORTED to the
//     user (failedYears) instead of silently disappearing.
function fetchVillageStatsChunked(villageGeom, aoi, sy, ey, season, keys, onDone) {
  var queue       = buildYearChunks(sy, ey, CFG.yearChunkSize);
  var totalChunks = queue.length;
  var doneChunks  = 0;
  var allProps    = [];
  var failedYears = [];

  function next() {
    if(!queue.length){
      allProps.sort(function(a,b){ return a.year-b.year; });
      onDone(allProps, failedYears); return;
    }
    var c = queue.shift();
    doneChunks++;
    ptStatusLbl.setValue('⏳ Fetching ' + c[0] + (c[1]>c[0] ? '–'+c[1] : '') +
      '  (' + Math.min(doneChunks,totalChunks) + ' / ' + totalChunks +
      (failedYears.length ? ' · retrying failures' : '') + ') …');
    ptStatusLbl.style().set('color', AM);

    buildVillageAnnualStatsFC(villageGeom, aoi, String(c[0]), String(c[1]), season, keys)
      .evaluate(function(result, error){
        if(error){
          if(c[1] > c[0]){
            // Split the failed chunk into single years and retry each
            for(var y=c[1]; y>=c[0]; y--) queue.unshift([y,y]);
            totalChunks += (c[1]-c[0]+1) - 1;
          } else {
            failedYears.push({year:c[0], error:String(error)});
          }
        } else if(result && result.features){
          result.features.forEach(function(f){ allProps.push(f.properties); });
        }
        next();
      });
  }
  next();
}

// ── Chart builder: one line chart per index (returns Z-filtered pairs) ───────
function addVillageIndexChart(features, key, villageName) {
  var rawPairs = features
    .filter(function(f){ return f[key]!==null && f[key]!==undefined; })
    .map(function(f){ return {year:Number(f.year), v:Number(f[key])}; });

  if(!rawPairs.length){
    pPointCharts.add(card([
      lb(STAT_LABELS[key] + ' — no valid values for this village in the selected range/season.',
         RD,'10px')
    ]));
    return [];
  }

  var filtered = zFilterYearSeries(rawPairs);
  if(!filtered.length){
    pPointCharts.add(card([
      lb(STAT_LABELS[key] + ' — all observations removed by |Z|≤' + CFG.Z_THRESH + ' filter.',
         RD,'10px')
    ]));
    return [];
  }

  var nRemoved = rawPairs.length - filtered.length;
  var dataTable = [['Year', STAT_LABELS[key]]].concat(
    filtered.map(function(r){ return [r.year, r.v]; })
  );

  var chart = ui.Chart(dataTable, 'LineChart', {
    title: STAT_LABELS[key] + ' — Annual Seasonal Median · ' + villageName +
           (nRemoved > 0 ? '  (' + nRemoved + ' outlier yr' + (nRemoved>1?'s':'') + ' removed)' : ''),
    titleTextStyle:{color:T1,fontSize:11,bold:true},
    pointSize:5, lineWidth:2.5,
    series:{0:{color:STAT_COLORS[key]}},
    trendlines:{0:{
      type:'linear', color:'#9ca3af', lineWidth:2, opacity:0.7,
      lineDashStyle:[4,4], showR2:true, visibleInLegend:true, labelInLegend:'Trend'
    }},
    hAxis:{title:'Year', format:'####',
           titleTextStyle:{color:T2}, textStyle:{color:T2}, gridlines:{color:BD}},
    vAxis:{title:STAT_LABELS[key],
           titleTextStyle:{color:T2}, textStyle:{color:T2}, gridlines:{color:BD}},
    legend:{position:'bottom', textStyle:{color:T2}},
    backgroundColor:W,
    chartArea:{backgroundColor:W, left:55, top:35, width:'80%', height:'60%'}
  });

  pPointCharts.add(chart);
  return filtered;
}

// ── Annual values table: one row PER YEAR of the selected range ──────────────
// Columns = Year | one column per selected index (annual seasonal village median).
// Every year from sy to ey gets a row (e.g. 2016–2025 → 10 rows); years with
// no valid data show '—'. Values flagged '*' are |Z|>3 outlier years, which
// are excluded from the charts and the summary statistics but still listed
// here so the full record is visible.
function buildAnnualValuesTable(features, selectedKeys, sy, ey) {
  var byYear = {};
  features.forEach(function(f){ byYear[Number(f.year)] = f; });

  // Per-index set of years KEPT by the temporal Z filter (to flag outliers)
  var keptYears = {};
  selectedKeys.forEach(function(key){
    var rawPairs = features
      .filter(function(f){ return f[key]!==null && f[key]!==undefined; })
      .map(function(f){ return {year:Number(f.year), v:Number(f[key])}; });
    var kept = {};
    zFilterYearSeries(rawPairs).forEach(function(r){ kept[r.year]=true; });
    keptYears[key] = kept;
  });

  var header = ['Year'].concat(selectedKeys.map(function(k){ return STAT_LABELS[k]; }));
  var rows = [];
  for (var y = parseInt(sy,10); y <= parseInt(ey,10); y++) {
    var f = byYear[y];
    var row = [y];
    selectedKeys.forEach(function(key){
      var v = f ? f[key] : null;
      if (v===null || v===undefined) { row.push('—'); }
      else {
        var s = Number(v).toFixed(4);
        if (!keptYears[key][y]) s += ' *';   // outlier year
        row.push(s);
      }
    });
    rows.push(row);
  }
  return ui.Chart([header].concat(rows), 'Table',
    {allowHtml:true, pageSize:Math.max(rows.length, 10)});
}

// ── Summary table: Median / Mean / Max / Min / StdDev / Count per index ──────
function buildVillageSummaryTable(summaries, selectedKeys) {
  function fmt(v){ return (v===null||v===undefined) ? '—' : Number(v).toFixed(4); }
  var rows = selectedKeys.map(function(key){
    var s = summaries[key] || {median:null,mean:null,max:null,min:null,stdDev:null,count:0};
    return [STAT_LABELS[key], fmt(s.median), fmt(s.mean), fmt(s.max), fmt(s.min), fmt(s.stdDev), s.count];
  });
  return ui.Chart(
    [['Index','Median','Mean','Max','Min','StdDev','Count (valid years)']].concat(rows),
    'Table', {allowHtml:true, pageSize:10}
  );
}

// ── Main orchestrator ────────────────────────────────────────────────────────
function runVillageExtraction() {
  var unitName = getUnitName();
  if(!_villageGeom){
    ptStatusLbl.setValue('⚠ Click a '+unitName.toLowerCase()+' on the map first');
    ptStatusLbl.style().set('color',RD); return;
  }
  var sy=selStart.getValue(), ey=selEnd.getValue();
  if(parseInt(sy)>parseInt(ey)){
    ptStatusLbl.setValue('⚠ Start year > end year');
    ptStatusLbl.style().set('color',RD); return;
  }
  var selectedKeys = getSelectedIndexKeys();
  if(!selectedKeys.length){
    ptStatusLbl.setValue('⚠ No indices checked — check at least one index');
    ptStatusLbl.style().set('color',RD); return;
  }

  var aoi    = getUnits().geometry();
  var season = selSeason.getValue();

  pPointCharts.clear();
  pYearTable.clear();
  pPointTable.clear();
  pPointCharts.add(lb('⏳ Extracting annual time series — please wait …', T2,'10px'));

  fetchVillageStatsChunked(_villageGeom, aoi, sy, ey, season, selectedKeys,
                           function(features, failedYears){
    _villageAnnualFeatures = features;
    pPointCharts.clear();
    pYearTable.clear();
    pPointTable.clear();

    // Report any years whose server request failed even after per-year retry
    if(failedYears && failedYears.length){
      var yrsList = failedYears.map(function(f){ return f.year; }).join(', ');
      pPointCharts.add(card([
        lb('⚠ ' + failedYears.length + ' year(s) could not be computed (server ' +
           'timeout / memory limit) and are shown as — : ' + yrsList, RD,'10px'),
        lb('Tip: uncheck RSETI/SWATI (heaviest indices), shorten the date range, ' +
           'or click DATA EXTRACT again — retries often succeed.', T2,'9px')
      ]));
    }

    if(!features.length){
      pPointCharts.add(card([lb('⚠ No valid years found for this range/season.', RD,'10px')]));
      pYearTable.add(card([lb('⚠ No data to display.', RD,'10px')]));
      pPointTable.add(card([lb('⚠ No data to display.', RD,'10px')]));
      ptStatusLbl.setValue('⚠ No data'); ptStatusLbl.style().set('color',RD); return;
    }

    var vName = _villageName || ('Selected '+unitName);

    var summaries = {};
    selectedKeys.forEach(function(key){
      var filtered = addVillageIndexChart(features, key, vName);
      if(filtered.length){
        var vals = filtered.map(function(r){ return r.v; });
        summaries[key] = {
          median: jsMedian(vals), mean:jsMean(vals),
          max:jsMax(vals), min:jsMin(vals),
          stdDev: jsStdDev(vals), count:vals.length
        };
      } else {
        summaries[key] = {median:null,mean:null,max:null,min:null,stdDev:null,count:0};
      }
    });

    // ── Annual values table: Year vs median, one row per year of the range ──
    pYearTable.add(lb(
      'Annual values table · ' + sy + '–' + ey + ' (' +
      (parseInt(ey,10)-parseInt(sy,10)+1) + ' years) · ' + season +
      ' · ' + unitName + ': ' + vName,
      T2,'9px'
    ));
    pYearTable.add(buildAnnualValuesTable(features, selectedKeys, sy, ey));

    pPointTable.add(lb(
      'Summary over full time range · ' + unitName + ': ' + vName,
      T2,'9px'
    ));
    pPointTable.add(buildVillageSummaryTable(summaries, selectedKeys));

    if(failedYears && failedYears.length){
      ptStatusLbl.setValue('✓ Series ready (' + failedYears.length +
        ' yr failed — see warning above) — ' + vName);
      ptStatusLbl.style().set('color', AM);
    } else {
      ptStatusLbl.setValue('✓ Time series ready — ' + vName);
      ptStatusLbl.style().set('color', GN);
    }
  });
}

// ── Map click handler: identify + highlight the clicked admin unit ───────────
MAP.onClick(function(coords){
  var unitName = getUnitName();
  var pt  = ee.Geometry.Point([coords.lon, coords.lat]);
  var hit = getUnits().filterBounds(pt);

  ptCoordLbl.setValue('⏳ Identifying '+unitName.toLowerCase()+' …');
  ptStatusLbl.setValue(''); ptStatusLbl.style().set('color',T2);

  // Lightweight: pull ONLY the attribute table of the hit feature (no
  // geometry). If the configured name field is absent (e.g. the district
  // shapefile uses a different attribute), fall back to the first text field.
  hit.limit(1).map(function(f){ return ee.Feature(null, f.toDictionary()); })
    .evaluate(function(fcJson){
    if(!fcJson || !fcJson.features || !fcJson.features.length){
      ptCoordLbl.setValue('⚠ Clicked outside '+unitName.toLowerCase()+' boundaries — try again');
      _villageGeom=null; _villageName=null;
      if(_villageHL){ MAP.layers().remove(_villageHL); _villageHL=null; }
      return;
    }
    var props = fcJson.features[0].properties || {};
    var name  = props[getUnitProp()];
    if(name===undefined || name===null){
      var ks = Object.keys(props);
      for(var i=0;i<ks.length;i++){
        if(typeof props[ks[i]]==='string'){ name = props[ks[i]]; break; }
      }
    }
    _villageName = (name!==undefined && name!==null) ? String(name) : ('Selected '+unitName);

    var feat = ee.Feature(hit.first());
    _villageGeom = feat.geometry();

    ptCoordLbl.setValue('🏘 ' + unitName + ': ' + _villageName +
      '  (lat ' + coords.lat.toFixed(4) + ', lon ' + coords.lon.toFixed(4) + ')');

    if(_villageHL) MAP.layers().remove(_villageHL);
    _villageHL = ui.Map.Layer(
      ee.Image().paint(ee.FeatureCollection([feat]),0,3),
      {palette:[HL]}, 'Selected '+unitName+': ' + _villageName
    );
    MAP.layers().add(_villageHL);

    ptStatusLbl.setValue(unitName+' set — click  ▶ DATA EXTRACT');
    ptStatusLbl.style().set('color',T2);
  });
});

btnPtExtract.onClick(runVillageExtraction);

// Clears the selected admin unit + all inspector output.
// Called by the ✕ Clear button AND when the Analysis Unit is switched.
function clearSelectedAdmin(){
  _villageGeom=null; _villageName=null; _villageAnnualFeatures=null;
  if(_villageHL){ MAP.layers().remove(_villageHL); _villageHL=null; }
  ptCoordLbl.setValue('No admin unit selected — click the map');
  pPointCharts.clear();
  pPointCharts.add(card([lb(INIT_CHART_MSG, T2,'10px')]));
  pYearTable.clear();
  pYearTable.add(card([lb(INIT_YEARTBL_MSG, T2,'10px')]));
  pPointTable.clear();
  pPointTable.add(card([lb(INIT_TABLE_MSG, T2,'10px')]));
  ptStatusLbl.setValue(''); ptStatusLbl.style().set('color',T2);
}
btnPtClear.onClick(clearSelectedAdmin);

// ============================================================================
// SECTION 17 — EXPORT HANDLERS (app-safe: direct download links)
// ============================================================================
// NOTE: Export.image.toDrive / Export.table.toDrive create TASKS, which only
// exist in the Code Editor — they silently do nothing (or fail) inside a
// published EE App. getDownloadURL works in both environments.

function showDownloadLink(text, url){
  exportLinkSlot.clear();
  exportLinkSlot.add(ui.Label(text, {
    color:AC, fontSize:'11px', fontWeight:'bold', margin:'2px 0px',
    backgroundColor:'rgba(0,0,0,0)'
  }, url));
}

btnExMap.onClick(function(){
  if(!_lstImg||!_aoi){ setStatus('⚠ Run APPLY ANALYSIS first',RD); return; }
  setStatus('⏳ Preparing GeoTIFF download link …', AM);
  exportLinkSlot.clear();
  exportLinkSlot.add(lb('⏳ Generating link …', T2,'10px'));
  _lstImg.getDownloadURL({
    name:  'Taoyuan_MODIS_LST_'+selStart.getValue()+'_'+selEnd.getValue(),
    scale: CFG.scale,
    region:_aoi,
    crs:   'EPSG:4326',
    format:'GEO_TIFF',
    filePerBand:false
  }, function(url, err){
    if(err || !url){
      exportLinkSlot.clear();
      exportLinkSlot.add(lb('⚠ Download failed: '+(err||'unknown error'), RD,'10px'));
      setStatus('⚠ Map export failed', RD); return;
    }
    showDownloadLink('⬇  Download LST GeoTIFF', url);
    setStatus('✓ GeoTIFF link ready below', GN);
  });
});

btnExData.onClick(function(){
  if(!_villageAnnualFeatures || !_villageAnnualFeatures.length){
    setStatus('⚠ Run DATA EXTRACT first',RD); return;
  }
  setStatus('⏳ Preparing CSV download link …', AM);
  exportLinkSlot.clear();
  exportLinkSlot.add(lb('⏳ Generating link …', T2,'10px'));
  // Wrap already-resolved client-side data (cheap — known numbers only)
  var unitName = getUnitName();
  var vName = _villageName || unitName;
  var feats = _villageAnnualFeatures.map(function(p){
    var q = {}; Object.keys(p).forEach(function(k){ q[k]=p[k]; });
    q.UNIT      = unitName;
    q.UNIT_NAME = vName;
    return ee.Feature(null,q);
  });
  ee.FeatureCollection(feats).getDownloadURL(
    'csv', null,
    'Taoyuan_MODIS_TimeSeries_'+unitName+'_'+selStart.getValue()+'_'+selEnd.getValue(),
    function(url, err){
      if(err || !url){
        exportLinkSlot.clear();
        exportLinkSlot.add(lb('⚠ Download failed: '+(err||'unknown error'), RD,'10px'));
        setStatus('⚠ CSV export failed', RD); return;
      }
      showDownloadLink('⬇  Download Time Series CSV ('+vName+')', url);
      setStatus('✓ CSV link ready below', GN);
    });
});

// ============================================================================
// SECTION 18 — NOTES
// ============================================================================
// APPLY ANALYSIS: loads QC-masked MOD11A1 + MOD09GA over the FULL date range,
// builds the six-index seasonal median stack, reduces every index to its
// MEDIAN PER ADMIN UNIT (village or district — one reduceRegions call), and
// displays six choropleth layers (2–98 percentile stretch across unit medians).
//
// ADMIN INSPECTOR:
//   1) Click a admin in the map → the app looks up its name (VILLENG for
//      villages; TOWNENG or first text field for districts) and highlights it.
//   2) Check indices   3) Set date range   4) Click DATA EXTRACT.
//   For each year with ≥1 QC-valid MODIS image, the same annual seasonal
//   median composite used for the maps is reduced to the MEDIAN over the
//   clicked village/district polygon. Each series is
//   passed through the temporal |Z| ≤ 3 outlier filter before charting.
//   The series ALWAYS spans the full selected range: e.g. 2016–2025 → one
//   annual median per year = 10 values (years with zero valid MODIS data show
//   '—' in the table and are simply absent from the charts).
//   OUTPUT (three blocks, in order):
//     a) One line chart per index — Year vs annual seasonal village median,
//        linear trendline with R².
//     b) ANNUAL VALUES TABLE — Year vs median value, one row per year of the
//        selected range, one column per checked index. '*' marks |Z|>3
//        outlier years (excluded from charts/summary but still listed).
//     c) Summary table — Median / Mean / Max / Min / StdDev / Count of valid
//        non-outlier years, per index.
//   EXPORT: "Export Time Series (CSV)" downloads the raw annual values
//   (year + the checked indices + unit name) via a direct link.
//
// ============================================================================
// APP-PUBLISHING NOTES — fixing "there was an error loading some parts
// of the map" in the published app:
// ============================================================================
// 1. SHARE YOUR ASSET WITH THE APP (the #1 cause of this error).
//    A published app runs under a service account, NOT under your Google
//    account, so it cannot read your private assets unless you share them:
//      • In the Code Editor Assets tab → hover 'Village_name' AND 'Fdistrict'
//        → Share icon → tick "Anyone can read" (or add the app's service-account email), OR
//      • In the app-publishing dialog, expand the asset-permissions section
//        and let Earth Engine share the listed assets with the app for you.
//    Do this for EVERY asset the script reads.
// 2. The old try/catch fallback around the asset has been removed — a
//    client-side try/catch can never catch a server-side permission error;
//    it only made the failure look like a random map-tile error.
// 3. Export.image / Export.table tasks do NOT run inside published apps
//    (there is no Tasks tab for app users). Both export buttons now use
//    getDownloadURL links instead, which work in the Editor AND the app.
//    Direct downloads are capped (~50 MB / 32 MB request); the 1 km MODIS
//    LST grid over Taoyuan is far below that limit.
// 4. If tiles still time out on very long date ranges, shorten the range or
//    raise CFG.tileScale (e.g. 8) — apps have the same per-tile compute
//    limits as the Editor, but no retry-on-demand.

// ============================================================================
// SECTION 19 — RESET
// ============================================================================
function resetAll(){
  MAP.layers().reset();
  MAP.setCenter(CFG.LON, CFG.LAT, CFG.ZOOM);
  selStart.setValue('2001');
  selEnd.setValue(String(CFG.END_YEAR));
  selSeason.setValue('All Seasons');
  selUnit.setValue(DEFAULT_UNIT, false);   // back to Village, no onChange fire
  [ckLST,ckSUHI,ckNDVI,ckNDBI,ckRSETI,ckSWATI].forEach(function(c){c.setValue(true);});

  // Clear Admin Inspector
  _villageGeom=null; _villageName=null; _villageAnnualFeatures=null;
  _villageHL=null; _unitBoundaryLayer=null;
  ptCoordLbl.setValue('No admin unit selected — click the map');
  ptStatusLbl.setValue(''); ptStatusLbl.style().set('color',T2);
  pPointCharts.clear();
  pPointCharts.add(card([lb(INIT_CHART_MSG, T2,'10px')]));
  pYearTable.clear();
  pYearTable.add(card([lb(INIT_YEARTBL_MSG, T2,'10px')]));
  pPointTable.clear();
  pPointTable.add(card([lb(INIT_TABLE_MSG, T2,'10px')]));
  exportLinkSlot.clear();

  // Clear map state, redraw default-unit boundary
  _lstImg=null; _aoi=null; _unitStatsFC=null;
  showUnitBoundary();
  updateDescPanel('LST');
  setStatus('Ready — click APPLY ANALYSIS to load the maps, then click a village/district', T2);
}

btnApply.onClick(runAnalysis);
btnReset.onClick(resetAll);

// Draw the default analysis-unit (Village) boundary at startup
showUnitBoundary();

// ============================================================================
// END — TAOYUAN ENVIRONMENTAL MONITORING APP v9.2 (ADMIN-UNIT EDITION)
// ============================================================================
