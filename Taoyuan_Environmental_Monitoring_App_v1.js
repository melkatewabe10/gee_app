// ============================================================================
// TAOYUAN ENVIRONMENTAL MONITORING APP v8.9 — MODIS EDITION
// Google Earth Engine · Code Editor (JavaScript API)
// ============================================================================
// v8.0–v8.7: see Taoyuan_Environmental_Monitoring_App_v8.8.js for full log.
// ============================================================================
// v8.9 CHANGES (vs v8.8):
//  30. Year-wise REGIONAL statistics panels (pStatsCharts / pStatsTables)
//      REMOVED entirely. APPLY ANALYSIS now populates the six map layers
//      only; all statistics output is now handled by the Pixel Inspector.
//  31. Pixel Inspector extended from the fixed LST/NDVI/NDBI trio (v8.8) to
//      ALL SIX indices (LST, SUHI, NDVI, NDBI, RSETI, SWATI) — only those
//      currently checked in the Control Panel Indices section are shown.
//  32. Pixel value per year = ONE number: the seasonal annual MEDIAN composite
//      value at the clicked point. Built by computeIndexStackForCollection()
//      (the exact same compositing pipeline used for the map layers), then
//      extracted at the point via reduceRegion(mean). No more per-date daily
//      observations — the chart X-axis is Year, not calendar date.
//  33. TEMPORAL Z-score outlier mask (|Z| ≤ CFG.Z_THRESH = 3) applied
//      PER INDEX across the year-by-year series: removes anomalous years
//      (e.g. those dominated by seasonally cloud-contaminated composites)
//      from both the chart and the summary statistics.
//  34. ONE LINE CHART per selected index (Year × annual seasonal median),
//      with the same Google Charts linear trendline (R² shown) used
//      throughout this script. One chart widget per index, no overlapping.
//  35. ONE SUMMARY TABLE below the charts: rows = selected indices; columns =
//      Median / Max / Min / StdDev / Count (number of valid, non-outlier
//      years), all computed over the full selected time range at the
//      clicked pixel.
//  36. Export buttons (Export Map | Export Stats Report) moved to the BOTTOM
//      of the centre panel, below the Pixel Inspector output.
//      "Export Stats Report" now exports the raw annual point values (year +
//      all six index values at the clicked pixel) as a CSV.
// ============================================================================

// ============================================================================
// SECTION 1 — CONFIGURATION
// ============================================================================
var CFG = {
  assetId:       'projects/ee-tewabe60/assets/Fdistrict',
  scale:         1000,     // MODIS 1 km grid
  statsScale:    1000,
  tileScale:     4,
  nSamples:      400,      // random pixel sample size for spatial Z-masks /
                            // normalization inside index functions (RSETI/SWATI)
  sampleSeed:    0,
  yearChunkSize: 4,        // years per server request in point extraction
  NDVI_RURAL:    0.5,      // NDVI threshold for SUHI rural mask
  Z_THRESH:      3,        // |Z| threshold — spatial (RSETI/SWATI) AND temporal
                            // (Pixel Inspector year-series outlier filter)
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

var PALETTES = {
  LST:  { pal:['#2c7bb6','#abd9e9','#ffffbf','#fdae61','#d7191c'], min:20, max:50, unit:'°C',
           label:'LST — Land Surface Temperature (°C, MODIS 1 km)' },
  SUHI: { pal:['#fff7ec','#fee8c8','#fdd49e','#fdbb84','#fc8d59',
               '#ef6548','#d7301f','#b30000','#7f0000'], min:0, max:10, unit:'°C',
           label:'SUHI — Urban Heat Island Intensity (°C)' },
  NDVI: { pal:['#d73027','#fc8d59','#fee08b','#d9ef8b','#1a9850'], min:-0.2, max:0.8,
           unit:'index', label:'NDVI — Normalized Difference Vegetation Index' },
  NDBI: { pal:['#30123b','#4454c4','#1f9eb5','#40be70','#c2df25',
               '#fe9b2d','#e55709','#900c00'], min:-0.5, max:0.5,
           unit:'index', label:'NDBI — Normalized Difference Built-up Index' },
  RSETI:{ pal:['#8c510a','#d8b365','#f6e8c3','#c7eae5','#5ab4ac','#01665e'], min:0, max:1,
           unit:'index', label:'RSETI — Relative Evapotranspiration Index' },
  SWATI:{ pal:['#313695','#4575b4','#74add1','#fee090','#f46d43','#d73027'], min:0, max:1,
           unit:'index', label:'SWATI — Surface Water Availability-Temperature Index' }
};

var INFO = {
  LST:  { desc:   'Land Surface Temperature from MODIS MOD11A1 daily LST product (Terra, 1 km). NASA generalized split-window algorithm with land-cover based emissivity. QC_Day mandatory-QA and LST-error-flag masking applied per pixel.',
           formula:'LST_C = (LST_Day_1km × 0.02) − 273.15',
           ref:    'Wan (2014); MOD11 LST/E Product User Guide, NASA LP DAAC' },
  SUHI: { desc:   'Urban heat island intensity. Rural baseline = pixels with NDVI > 0.5 (MOD09GA, resampled to 1 km), computed exactly over the AOI via reduceRegion (not sampled). Reference = median LST of rural pixels.',
           formula:'SUHI = LST − median(LST | NDVI > 0.5)',
           ref:    'Weng et al. (2004); Oke (1982)' },
  NDVI: { desc:   'Normalized Difference Vegetation Index from MOD09GA daily surface reflectance (native 500 m, resampled to 1 km to match MOD11A1).',
           formula:'NDVI = (b02 − b01) / (b02 + b01)   [NIR, Red]',
           ref:    'Rouse et al. (1974); Vermote (2015) MOD09 User Guide' },
  NDBI: { desc:   'Normalized Difference Built-up Index — impervious surfaces, from MOD09GA SWIR1/NIR reflectance.',
           formula:'NDBI = (b05 − b02) / (b05 + b02)   [SWIR1, NIR]',
           ref:    'Zha et al. (2003)' },
  RSETI:{ desc:   'Relative Surface Evapotranspiration Index. NDLI from MOD09GA Green/Red/SWIR1, outlier-masked (|Z|≤3) before min–max normalization over the AOI.',
           formula:'NDLI=(b04−b01)/(b04+b01+b05)   RSETI=(NDLI−min)/(max−min)',
           ref:    'Allen et al. (1998)' },
  SWATI:{ desc:   'Surface Water Availability-Temperature Index. NDVI, NDLI (MOD09GA) and LST (MOD11A1) individually Z-masked (|Z|≤3) then min–max normalized over the AOI.',
           formula:'SWATI=√(((1−NDLI_n)²+(1−NDVI_n)²+LST_n²)/3)',
           ref:    'Meng et al. (2019)' }
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

// ── Annual composite stack (all 6 indices), reused by map layers AND point
//    extraction. LST band named 'LST' here so it stays consistent when
//    adding bands; computeSUHI/computeSWATI receive it renamed to 'LST_C'.
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

// ============================================================================
// SECTION 9 — PERCENTILE STRETCH (2–98)
// ============================================================================
function getP298(image, band, aoi, callback) {
  var sample = sampleImage(image,[band],aoi);
  var stats  = colStats(sample, band, ee.Reducer.percentile([2,98]));
  stats.evaluate(function(v){ callback(v?v.p2:null, v?v.p98:null); });
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

function mkCk(t){ return ui.Checkbox({label:t, value:true,
  style:{color:T1,fontSize:'11px',margin:'2px 0px',backgroundColor:'rgba(0,0,0,0)'}}); }
var ckLST   = mkCk('LST');
var ckSUHI  = mkCk('SUHI');
var ckNDVI  = mkCk('NDVI');
var ckNDBI  = mkCk('NDBI');
var ckRSETI = mkCk('RSETI');
var ckSWATI = mkCk('SWATI');
var idxCard = card([sh('📊  Indices'),ckLST,ckSUHI,ckNDVI,ckNDBI,ckRSETI,ckSWATI]);

// ── Pixel Inspector controls ──────────────────────────────────────────────────
var ptCoordLbl   = lb('No point selected — click the map', T2,'10px');
var btnPtExtract = ui.Button({label:'▶  EXTRACT POINT SERIES', style:{
  color:BLK, backgroundColor:W, fontSize:'11px', fontWeight:'bold',
  padding:'6px 10px', margin:'3px 0px', stretch:'horizontal', border:'1px solid '+BD
}});
var btnPtClear   = grayBtn('✕  Clear Point');
var ptStatusLbl  = lb('', T2,'10px');
var ptCard = card([
  sh('📍  Pixel Inspector'),
  lb('1) Click map to set point  2) Check indices  3) Set date range  4) Click EXTRACT', T2,'9px'),
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
  [dateCard, seasonCard, idxCard, ptCard, widthCard, btnCard],
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
  lb('Colour Scale (2–98 pctile):',BLK,'10px',true), descCBSlot]);

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
  [phead('MAP — Taoyuan Study Area (MODIS 1 km · AOI Clipped · Cloud-Free Median)'), MAP],
  ui.Panel.Layout.flow('vertical'),
  {stretch:'both', border:'1px solid '+BD, margin:'0px 0px 2px 0px'}
);

var mapHeightSlider = ui.Slider({min:200, max:700, value:400, step:10,
  style:{stretch:'horizontal', margin:'2px 0px'}});
mapHeightSlider.onSlide(function(v){ MAP.style().set('height', v+'px'); });
var mapResizeCard = card([sh('↕  Map Height'), mapHeightSlider]);

// ── Pixel Inspector output panels (populated by runPointExtraction) ───────────
var INIT_CHART_MSG = '📍 Set a point on the map and click  ▶ EXTRACT POINT SERIES  to generate one chart per selected index (annual seasonal median · |Z|≤' + CFG.Z_THRESH + ' filtered).';
var INIT_TABLE_MSG = '📍 Summary statistics (Median / Max / Min / StdDev / Count) will appear here after extraction.';

var pPointCharts = ui.Panel(
  [card([lb(INIT_CHART_MSG, T2,'10px')])],
  ui.Panel.Layout.flow('vertical'),
  {backgroundColor:GR, margin:'2px 0px'}
);
var pPointTable = ui.Panel(
  [card([lb(INIT_TABLE_MSG, T2,'10px')])],
  ui.Panel.Layout.flow('vertical'),
  {backgroundColor:GR, margin:'2px 0px'}
);

// ── Export buttons (at the BOTTOM of the centre panel) ───────────────────────
var btnExMap  = ui.Button({label:'Export Map (LST GeoTIFF)', style:{
  color:BLK, backgroundColor:W, fontSize:'11px', fontWeight:'bold',
  padding:'6px 10px', margin:'3px 0px', stretch:'horizontal', border:'1px solid '+BD
}});
var btnExData = ui.Button({label:'Export Stats Report (CSV)', style:{
  color:BLK, backgroundColor:W, fontSize:'11px', fontWeight:'bold',
  padding:'6px 10px', margin:'3px 0px', stretch:'horizontal', border:'1px solid '+BD
}});
var exportCard = card([sh('💾  Export'), hrow([btnExMap, btnExData])]);

var inspectorPanel = ui.Panel(
  [phead('PIXEL INSPECTOR — Annual Seasonal Median at Clicked Point (|Z|≤' + CFG.Z_THRESH + ' Outlier Filtered)'),
   ui.Panel([mapResizeCard, pPointCharts, pPointTable, exportCard],
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
// SECTION 15 — ANALYSIS ENGINE (map layers only; stats via Pixel Inspector)
// ============================================================================
var _lstImg = null, _aoi = null;

function setStatus(msg,clr){ statusLbl.setValue(msg); statusLbl.style().set('color',clr||T2); }

function runAnalysis() {
  setStatus('⏳ Starting …', AM);
  MAP.layers().reset();

  var sy = selStart.getValue(), ey = selEnd.getValue();
  if (parseInt(sy)>parseInt(ey)){ setStatus('⚠ Start year > end year',RD); return; }
  var season = selSeason.getValue();

  var aoi;
  try { aoi = ee.FeatureCollection(CFG.assetId).geometry(); }
  catch(e){ aoi = ee.Geometry.Rectangle([120.85,24.75,121.55,25.35]); }
  _aoi = aoi;

  setStatus('⏳ Loading MODIS collections …', AM);
  var lstCol = loadMOD11A1(aoi, sy+'-01-01', ey+'-12-31', season);
  var srCol  = loadMOD09GA(aoi, sy+'-01-01', ey+'-12-31', season);

  setStatus('⏳ Computing composites …', AM);
  var lstImg    = computeLSTComposite(lstCol, aoi); _lstImg = lstImg;
  var composite = computeComposite(srCol, aoi);

  setStatus('⏳ Computing indices …', AM);
  var ndviImg  = computeNDVI (composite, aoi);
  var ndbiImg  = computeNDBI (composite, aoi);
  var rsetiImg = computeRSETI(composite, aoi);
  var suhiImg  = computeSUHI (composite, lstImg, aoi);
  var swatiImg = computeSWATI(composite, lstImg, aoi);

  var IMGS = {
    LST:  {img:lstImg,   band:'LST_C'},
    SUHI: {img:suhiImg,  band:'SUHI'},
    NDVI: {img:ndviImg,  band:'NDVI'},
    NDBI: {img:ndbiImg,  band:'NDBI'},
    RSETI:{img:rsetiImg, band:'RSETI'},
    SWATI:{img:swatiImg, band:'SWATI'}
  };

  var CHK = {LST:ckLST,SUHI:ckSUHI,NDVI:ckNDVI,NDBI:ckNDBI,RSETI:ckRSETI,SWATI:ckSWATI};

  MAP.addLayer(composite,{bands:['sur_refl_b01','sur_refl_b04','sur_refl_b03'],min:0,max:0.3,gamma:1.4},'MODIS RGB',false);
  MAP.addLayer(ee.Image().paint(ee.FeatureCollection([ee.Feature(aoi)]),0,2),{palette:['#222222']},'AOI Boundary',true);

  setStatus('⏳ Adding map layers …', AM);
  var layerOrder = ['SWATI','RSETI','NDBI','NDVI','SUHI','LST'];
  var queue = layerOrder.slice();

  function addNextLayer() {
    if (!queue.length) {
      setStatus('✓ Map ready — set a point and click EXTRACT POINT SERIES', GN);
      return;
    }
    var key   = queue.shift();
    var entry = IMGS[key];
    getP298(entry.img, entry.band, aoi, function(p2,p98) {
      var mn = (p2!==null)  ? p2  : PALETTES[key].min;
      var mx = (p98!==null) ? p98 : PALETTES[key].max;
      if (CHK[key].getValue()) {
        MAP.addLayer(entry.img, {min:mn,max:mx,palette:PALETTES[key].pal}, key, true, 0.85);
        updateDescPanel(key, mn, mx);
      }
      addNextLayer();
    });
  }
  addNextLayer();
  MAP.centerObject(aoi, CFG.ZOOM);
}

// ============================================================================
// SECTION 16 — PIXEL INSPECTOR: ANNUAL MEDIAN AT CLICKED POINT
// ============================================================================
// ── Index & chart config ──────────────────────────────────────────────────────
var STAT_LABELS = { LST:'LST (°C)', SUHI:'SUHI (°C)', NDVI:'NDVI',
                    NDBI:'NDBI', RSETI:'RSETI', SWATI:'SWATI' };
var STAT_COLORS = { LST:'#d7191c', SUHI:'#d7301f', NDVI:'#1a9850',
                    NDBI:'#30123b', RSETI:'#01665e', SWATI:'#313695' };
var ALL_INDEX_KEYS = ['LST','SUHI','NDVI','NDBI','RSETI','SWATI'];

function getSelectedIndexKeys() {
  var ckMap = {LST:ckLST,SUHI:ckSUHI,NDVI:ckNDVI,NDBI:ckNDBI,RSETI:ckRSETI,SWATI:ckSWATI};
  return ALL_INDEX_KEYS.filter(function(k){ return ckMap[k].getValue(); });
}

// Splits [sy,ey] into consecutive sub-ranges of ≤ chunkSize years.
function buildYearChunks(sy, ey, chunkSize) {
  var s=parseInt(sy,10), e=parseInt(ey,10), chunks=[];
  while(s<=e){ var end=Math.min(s+chunkSize-1,e); chunks.push([s,end]); s=end+1; }
  return chunks;
}

// ── Client-side math helpers (operate on plain JS arrays) ────────────────────
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

// Temporal Z-score filter — keeps only years with |Z| ≤ CFG.Z_THRESH.
// pairs = [{year:…, v:…}, …]
function zFilterYearSeries(pairs) {
  if(pairs.length<2) return pairs;
  var vals=pairs.map(function(r){return r.v;}), m=jsMean(vals), sd=jsStdDev(vals);
  if(m===null||sd===null||sd<1e-9) return pairs;
  return pairs.filter(function(r){ return Math.abs((r.v-m)/sd)<=CFG.Z_THRESH; });
}

// ── State ─────────────────────────────────────────────────────────────────────
var _ptGeom            = null;   // ee.Geometry.Point of clicked location
var _ptLat             = null;   // JS number, for display in summary header
var _ptLon             = null;
var _ptMarkerLayer     = null;   // ui.Map.Layer showing the marker
var _pointAnnualFeatures = null; // raw JS array [{year,nImages,LST,SUHI,…}], for export

// ── Server-side: build annual composite stack and extract at ONE point ────────
// For one year-chunk: for each year with ≥1 image, build computeIndexStack()
// (same compositing as the map layers) then extract all 6 index values at
// the clicked point via reduceRegion. Single-pixel reduction — essentially
// free regardless of AOI size.
function buildPointAnnualStatsFC(point, aoi, sy, ey, season) {
  var years     = ee.List.sequence(parseInt(sy,10), parseInt(ey,10));
  var bandNames = ['LST','SUHI','NDVI','NDBI','RSETI','SWATI'];

  var yearInfo = ee.FeatureCollection(years.map(function(y){
    y = ee.Number(y);
    var s = ee.Date.fromYMD(y,1,1), e = s.advance(1,'year');
    return ee.Feature(null, {year:y, nImages:loadMOD11A1(aoi,s,e,season).size()});
  })).filter(ee.Filter.gt('nImages',0));

  return yearInfo.map(function(f){
    var y    = ee.Number(f.get('year'));
    var s    = ee.Date.fromYMD(y,1,1), e = s.advance(1,'year');
    var nImg = f.get('nImages');
    var stack = computeIndexStack(
      loadMOD11A1(aoi,s,e,season),
      loadMOD09GA(aoi,s,e,season),
      aoi
    );
    // reduceRegion at a single point — no AOI-wide scan, no memory risk
    var vals = stack.reduceRegion({
      reducer:   ee.Reducer.mean(),
      geometry:  point,
      scale:     CFG.scale,
      tileScale: CFG.tileScale,
      maxPixels: 10
    });
    var props = {year:y, nImages:nImg};
    bandNames.forEach(function(b){ props[b] = vals.get(b); });
    return ee.Feature(null, props);
  });
}

// ── Client-side chunked orchestration ────────────────────────────────────────
function fetchPointStatsChunked(point, aoi, sy, ey, season, onDone) {
  var chunks = buildYearChunks(sy, ey, CFG.yearChunkSize);
  var allProps = [];

  function doChunk(i) {
    if(i>=chunks.length){
      allProps.sort(function(a,b){ return a.year-b.year; });
      onDone(allProps); return;
    }
    var c = chunks[i];
    ptStatusLbl.setValue('⏳ Fetching ' + c[0] + '–' + c[1] +
      ' (' + (i+1) + ' / ' + chunks.length + ') …');
    ptStatusLbl.style().set('color', AM);
    buildPointAnnualStatsFC(point, aoi, String(c[0]), String(c[1]), season)
      .evaluate(function(result){
        if(result && result.features)
          result.features.forEach(function(f){ allProps.push(f.properties); });
        doChunk(i+1);
      });
  }
  doChunk(0);
}

// ── Chart builder: one line chart per index ───────────────────────────────────
// Returns the Z-filtered pairs array (used for summary stats).
function addPointIndexChart(features, key) {
  var rawPairs = features
    .filter(function(f){ return f[key]!==null && f[key]!==undefined; })
    .map(function(f){ return {year:Number(f.year), v:Number(f[key])}; });

  if(!rawPairs.length){
    pPointCharts.add(card([
      lb(STAT_LABELS[key] + ' — no valid pixel values at this point for the selected range/season.',
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
    title: STAT_LABELS[key] +
           ' — Annual Seasonal Median at Inspection Point' +
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

// ── Summary table ─────────────────────────────────────────────────────────────
// One row per selected index; columns = Median / Max / Min / StdDev / Count.
// Count = number of valid, non-outlier years used in the statistics.
function buildPointSummaryTable(summaries, selectedKeys) {
  function fmt(v){ return (v===null||v===undefined) ? '—' : Number(v).toFixed(4); }
  var rows = selectedKeys.map(function(key){
    var s = summaries[key] || {median:null,max:null,min:null,stdDev:null,count:0};
    return [STAT_LABELS[key], fmt(s.median), fmt(s.max), fmt(s.min), fmt(s.stdDev), s.count];
  });
  return ui.Chart(
    [['Index','Median','Max','Min','StdDev','Count (valid years)']].concat(rows),
    'Table', {allowHtml:true, pageSize:10}
  );
}

// ── Main orchestrator ─────────────────────────────────────────────────────────
function runPointExtraction() {
  if(!_ptGeom){
    ptStatusLbl.setValue('⚠ Click the map to set an inspection point first');
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

  var aoi;
  try { aoi = ee.FeatureCollection(CFG.assetId).geometry(); }
  catch(e){ aoi = ee.Geometry.Rectangle([120.85,24.75,121.55,25.35]); }

  var season = selSeason.getValue();

  pPointCharts.clear();
  pPointTable.clear();
  pPointCharts.add(lb('⏳ Extracting annual pixel series — please wait …', T2,'10px'));

  fetchPointStatsChunked(_ptGeom, aoi, sy, ey, season, function(features){
    _pointAnnualFeatures = features;
    pPointCharts.clear();
    pPointTable.clear();

    if(!features.length){
      pPointCharts.add(card([lb('⚠ No valid years found for this range/season.', RD,'10px')]));
      pPointTable.add(card([lb('⚠ No data to display.', RD,'10px')]));
      ptStatusLbl.setValue('⚠ No data'); ptStatusLbl.style().set('color',RD); return;
    }

    // ── Build one chart per selected index ──────────────────────────────────
    pPointCharts.add(lb(
      'One chart per index · ' + sy + '–' + ey + ' · ' + season +
      ' · Point: lat ' + (_ptLat!==null?Number(_ptLat).toFixed(4):'—') +
      ',  lon ' + (_ptLon!==null?Number(_ptLon).toFixed(4):'—'),
      T2,'9px'
    ));

    var summaries = {};
    selectedKeys.forEach(function(key){
      var filtered = addPointIndexChart(features, key);
      if(filtered.length){
        var vals = filtered.map(function(r){ return r.v; });
        summaries[key] = {
          median: jsMedian(vals), max:jsMax(vals), min:jsMin(vals),
          stdDev: jsStdDev(vals), count:vals.length
        };
      } else {
        summaries[key] = {median:null,max:null,min:null,stdDev:null,count:0};
      }
    });

    // ── Summary table ────────────────────────────────────────────────────────
    pPointTable.add(lb(
      'Summary over full time range at clicked point  |  Z-outlier threshold: ' + CFG.Z_THRESH +
      '  |  Count = valid, non-outlier years',
      T2,'9px'
    ));
    pPointTable.add(buildPointSummaryTable(summaries, selectedKeys));

    ptStatusLbl.setValue('✓ Point series ready');
    ptStatusLbl.style().set('color', GN);
  });
}

// ── Map click handler (drops/moves the inspection point marker) ───────────────
MAP.onClick(function(coords){
  _ptGeom = ee.Geometry.Point([coords.lon, coords.lat]);
  _ptLat  = coords.lat;
  _ptLon  = coords.lon;
  ptCoordLbl.setValue('📍 lat ' + coords.lat.toFixed(4) + ',  lon ' + coords.lon.toFixed(4));
  if(_ptMarkerLayer) MAP.layers().remove(_ptMarkerLayer);
  _ptMarkerLayer = ui.Map.Layer(
    ee.Image().paint(ee.FeatureCollection([ee.Feature(_ptGeom)]),0,6),
    {palette:[RD]}, 'Inspection Point'
  );
  MAP.layers().add(_ptMarkerLayer);
  ptStatusLbl.setValue('Point set — click  ▶ EXTRACT POINT SERIES');
  ptStatusLbl.style().set('color',T2);
});

btnPtExtract.onClick(runPointExtraction);

btnPtClear.onClick(function(){
  _ptGeom=null; _ptLat=null; _ptLon=null;
  if(_ptMarkerLayer){ MAP.layers().remove(_ptMarkerLayer); _ptMarkerLayer=null; }
  ptCoordLbl.setValue('No point selected — click the map');
  pPointCharts.clear();
  pPointCharts.add(card([lb(INIT_CHART_MSG, T2,'10px')]));
  pPointTable.clear();
  pPointTable.add(card([lb(INIT_TABLE_MSG, T2,'10px')]));
  ptStatusLbl.setValue(''); ptStatusLbl.style().set('color',T2);
});

// ============================================================================
// SECTION 17 — EXPORT HANDLERS (wired once at script load)
// ============================================================================
btnExMap.onClick(function(){
  if(!_lstImg||!_aoi){ setStatus('⚠ Run APPLY ANALYSIS first',RD); return; }
  Export.image.toDrive({
    image:_lstImg,
    description:'Taoyuan_MODIS_LST_'+selStart.getValue()+'_'+selEnd.getValue(),
    scale:CFG.scale, region:_aoi, crs:'EPSG:4326', maxPixels:1e13
  });
  setStatus('✓ LST export submitted — check Tasks', AC);
});

btnExData.onClick(function(){
  if(!_pointAnnualFeatures || !_pointAnnualFeatures.length){
    setStatus('⚠ Extract a point series first',RD); return;
  }
  // Wrap the already-resolved client-side data as an ee.FeatureCollection
  // (cheap — just wrapping known numbers, not re-running computation).
  var feats = _pointAnnualFeatures.map(function(p){ return ee.Feature(null,p); });
  Export.table.toDrive({
    collection: ee.FeatureCollection(feats),
    description:'Taoyuan_MODIS_PointStats_'+selStart.getValue()+'_'+selEnd.getValue(),
    fileFormat:'CSV'
  });
  setStatus('✓ Point stats export submitted — check Tasks', AC);
});

// ============================================================================
// SECTION 18 — NOTES
// ============================================================================
// APPLY ANALYSIS: loads QC-masked MOD11A1 (LST) and MOD09GA (NDVI/NDBI/RSETI/
// SWATI inputs), builds an annual median composite, and displays six index
// layers on the map. No statistics panels are generated.
//
// PIXEL INSPECTOR (EXTRACT POINT SERIES):
//   1. Click anywhere on the map to set the inspection point (red marker).
//   2. Check/uncheck indices and set date range / season as desired.
//   3. Click ▶ EXTRACT POINT SERIES.
//   For each year with ≥1 QC-valid MODIS image, computeIndexStack() builds
//   the same annual seasonal median composite used for the map layers, then
//   extracts all six index values at the single clicked pixel via
//   reduceRegion. Each index's year series is then passed through a TEMPORAL
//   Z-score filter (|Z| ≤ CFG.Z_THRESH = 3, computed from the series' own
//   mean/stdDev) to remove anomalous years before charting and summary stats.
//   OUTPUT:
//     • One line chart per selected index — Year vs. annual seasonal median,
//       with a linear trend line (R²).
//     • One summary table — Index | Median | Max | Min | StdDev |
//       Count (valid, non-outlier years) — computed over the full time range.
//   EXPORT: "Export Stats Report" exports the raw annual point values (before
//   Z-filtering) for all six indices as a CSV.

// ============================================================================
// SECTION 19 — RESET
// ============================================================================
function resetAll(){
  MAP.layers().reset();
  MAP.setCenter(CFG.LON, CFG.LAT, CFG.ZOOM);
  selStart.setValue('2001');
  selEnd.setValue(String(CFG.END_YEAR));
  selSeason.setValue('All Seasons');
  [ckLST,ckSUHI,ckNDVI,ckNDBI,ckRSETI,ckSWATI].forEach(function(c){c.setValue(true);});

  // Clear Pixel Inspector
  _ptGeom=null; _ptLat=null; _ptLon=null; _pointAnnualFeatures=null;
  if(_ptMarkerLayer){ MAP.layers().remove(_ptMarkerLayer); _ptMarkerLayer=null; }
  ptCoordLbl.setValue('No point selected — click the map');
  ptStatusLbl.setValue(''); ptStatusLbl.style().set('color',T2);
  pPointCharts.clear();
  pPointCharts.add(card([lb(INIT_CHART_MSG, T2,'10px')]));
  pPointTable.clear();
  pPointTable.add(card([lb(INIT_TABLE_MSG, T2,'10px')]));

  // Clear map state
  _lstImg=null; _aoi=null;
  updateDescPanel('LST');
  setStatus('Ready — click APPLY ANALYSIS to load map layers, then set a point', T2);
}

btnApply.onClick(runAnalysis);
btnReset.onClick(resetAll);

// ============================================================================
// END — TAOYUAN ENVIRONMENTAL MONITORING APP v8.9 (MODIS EDITION)
// ============================================================================

// NOTE:
// USE the village/district level and reduce the value to the median
// Use such maps for display
// use the statistics using such maps; when we click on a village, we can see the trend
