// plume-sapdata.js  v1.2
//
// Saponification values and fatty acid profiles for the oils, butters and
// waxes Plume knows about. Loaded as a plain script, like plume-core.js --
// no fetch, so it works offline and from a saved copy of the page.
//
// PROVENANCE
//   SAP values come from the SoapCalc chart, which lists KOH first and NaOH
//   second. Every row was checked against the fixed KOH/NaOH ratio of 1.4027
//   (the molar masses are 56.105 and 39.997), so the column order is confirmed
//   by chemistry rather than by trusting a header.
//
//   Fatty acid profiles are published compositions, each one checked by
//   predicting SAP from it: a triglyceride of an acid with molar mass M has
//   molar mass 3M + 38.04 and consumes 3 KOH, so a profile implies a SAP
//   value. Predictions run about 1% above the chart across the board, which is
//   what unsaponifiable matter does to real measured SAP. Anything further out
//   than 4% is either explained in a comment on the row or has no profile at
//   all -- a missing profile here means "not known reliably", never "zero".
//
//   Two SAP values are NOT from the chart and carry estimated:true on their
//   rows: chia seed oil (not on the chart) and pumpkin seed butter (no chart
//   row; it takes the oil's value, and a butter is usually the oil plus a
//   hardener, so its real SAP is likely a little lower). Anything with that
//   flag is good enough to calculate with and not good enough to trust
//   silently.
//
//   UNKNOWN ON PURPOSE (v1.1, Heide's decision 2026-10-16): murumuru, ucuuba
//   and sea buckthorn carry naoh:null, koh:null, unknown:true. The sources
//   disagreed (murumuru: three sources, three numbers; ucuuba: profile 13%
//   off the chart; sea buckthorn: seed-only and seed-and-berry grades differ
//   by 7%), and they are obscure or expensive enough that she would rather
//   see "missing SAP" than calculate lye from a number nobody can stand
//   behind. The rows stay so the review can find these oils and offer to
//   CLEAR a stored value; the lye calculator then flags them as missing.
//   Do not fill these back in without a source she accepts.
//
//   Profiles deliberately withheld: murumuru and ucuuba (both disagree with
//   the chart by more than 10% with no property of the oil to explain it) and
//   jojoba (a wax ester, so the triglyceride model does not describe it).
//
// WHY LOOKUP IS BY NAME AND NOT BY INCI
//   INCI names the botanical source, not the grade, and grade is what moves
//   the SAP value. Safflower and high-oleic safflower share
//   "Carthamus Tinctorius (Safflower) Seed Oil" but saponify at 0.137 and
//   0.135; virgin and 76-degree coconut share "Cocos Nucifera (Coconut) Oil".
//   Keying on INCI would hand one value to both members of each pair. Real
//   libraries also leave INCI blank far more often than they leave a name
//   blank. Names distinguish these; INCI does not.
//
// v1.2 (2026-10-16) added the Formula Botanica directory's names for six oils
// already here (Rosehip oil, Meadowfoam oil, Tamanu seed oil, Borage seed oil,
// Flaxseed oil, and its long fractionated coconut name). Same oil, same grade,
// so Quick add and the SAP review now recognise them; before, a library
// holding those names fell under "Not in the reference".
//
// Aliases never shadow another oil's primary name, so a lookup for
// "Olive oil" cannot land on "Olive oil (pomace)".
var PlumeSap = (function () {
  'use strict';

  // naoh / koh are grams of lye per gram of oil. fa is weight percent.
  var OILS = [
    { name:'Shea butter', aliases:[], inci:'Butyrospermum Parkii (Shea) Butter',
      naoh:0.128, koh:0.179, fa:{palmitic:6,stearic:37,oleic:44,linoleic:7} },
    { name:'Jojoba oil', aliases:[], inci:'Simmondsia Chinensis (Jojoba) Seed Oil',
      naoh:0.066, koh:0.092, fa:null },
    { name:'Sweet almond oil', aliases:[], inci:'Prunus Amygdalus Dulcis (Sweet Almond) Oil',
      naoh:0.139, koh:0.195, fa:{palmitic:7,stearic:2,oleic:69,linoleic:20} },
    { name:'Rosehip seed oil', aliases:['Rosehip oil'], inci:'Rosa Canina Seed Oil',
      naoh:0.133, koh:0.187, fa:{palmitic:4,stearic:2,oleic:15,linoleic:45,linolenic:33} },
    { name:'Argan oil', aliases:[], inci:'Argania Spinosa Kernel Oil',
      naoh:0.136, koh:0.191, fa:{palmitic:13,stearic:6,oleic:43,linoleic:37} },
    { name:'Fractionated coconut oil', aliases:['Caprylic capric triglyceride','Caprylic/capric triglyceride','Fractionated coconut','MCT oil','Fractionated coconut oil/ medium chain triglycerides (mct)'], inci:'Caprylic/Capric Triglyceride',
      naoh:0.232, koh:0.325, fa:{caprylic:55,capric:42,lauric:2} },
    { name:'Mango butter', aliases:[], inci:'Mangifera Indica (Mango) Seed Butter',
      naoh:0.136, koh:0.191, fa:{palmitic:7,stearic:40,oleic:46,linoleic:5} },
    { name:'Kokum butter', aliases:[], inci:'Garcinia Indica Seed Butter',
      naoh:0.135, koh:0.19, fa:{palmitic:2,stearic:57,oleic:39,linoleic:2} },
    { name:'Cocoa butter', aliases:[], inci:'Theobroma Cacao (Cocoa) Seed Butter',
      naoh:0.138, koh:0.194, fa:{palmitic:26,stearic:34,oleic:35,linoleic:3} },
    { name:'Murumuru butter', aliases:[], inci:'Astrocaryum Murumuru Seed Butter',
      naoh:null, koh:null, unknown:true, fa:null },
    { name:'Cupuacu butter', aliases:[], inci:'Theobroma Grandiflorum Seed Butter',
      naoh:0.137, koh:0.192, fa:{palmitic:9,stearic:35,oleic:42,linoleic:5} },
    { name:'Sea buckthorn oil', aliases:[], inci:'Hippophae Rhamnoides Fruit Oil',
      naoh:null, koh:null, unknown:true, fa:{palmitic:30,stearic:1,oleic:33,linoleic:29,linolenic:3} },
    { name:'Baobab oil', aliases:[], inci:'Adansonia Digitata Seed Oil',
      naoh:0.143, koh:0.2, fa:{palmitic:21,stearic:4,oleic:36,linoleic:31,linolenic:2} },
    { name:'Marula oil', aliases:[], inci:'Sclerocarya Birrea Seed Oil',
      naoh:0.137, koh:0.192, fa:{palmitic:10,stearic:7,oleic:70,linoleic:8} },
    { name:'Meadowfoam seed oil', aliases:['Meadowfoam oil'], inci:'Limnanthes Alba (Meadowfoam) Seed Oil',
      naoh:0.12, koh:0.169, fa:null },
    { name:'Castor oil', aliases:[], inci:'Ricinus Communis (Castor) Seed Oil',
      naoh:0.128, koh:0.18, fa:{oleic:4,ricinoleic:90,linoleic:4} },
    { name:'Hemp seed oil', aliases:[], inci:'Cannabis Sativa Seed Oil',
      naoh:0.138, koh:0.193, fa:{palmitic:6,stearic:2,oleic:12,linoleic:57,linolenic:21} },
    { name:'Avocado oil', aliases:[], inci:'Persea Gratissima (Avocado) Oil',
      naoh:0.133, koh:0.186, fa:{palmitic:16,stearic:2,oleic:65,linoleic:15} },
    { name:'Pumpkin seed butter', aliases:[], inci:'Cucurbita Pepo (Pumpkin) Seed Butter',
      naoh:0.139, koh:0.195, fa:{palmitic:13,stearic:7,oleic:34,linoleic:44}, estimated:true },
    { name:'Watermelon seed oil', aliases:[], inci:'Citrullus Lanatus (Watermelon) Seed Oil',
      naoh:0.135, koh:0.19, fa:{palmitic:12,stearic:10,oleic:18,linoleic:58} },
    { name:'Pomegranate seed oil', aliases:[], inci:'Punica Granatum Seed Oil',
      naoh:0.135, koh:0.19, fa:{palmitic:3,stearic:2,oleic:5,linoleic:7,linolenic:78} },
    { name:'Tamanu oil', aliases:['Tamanu seed oil'], inci:'Calophyllum Inophyllum Seed Oil',
      naoh:0.148, koh:0.208, fa:{palmitic:12,stearic:14,oleic:41,linoleic:31} },
    // ESTIMATED: not on the chart; inherited from the previous seeder value, which its own 62% linolenic profile corroborates to within 2%
    { name:'Chia seed oil', aliases:[], inci:'Salvia Hispanica Seed Oil',
      naoh:0.136, koh:0.19, fa:{palmitic:7,stearic:3,oleic:7,linoleic:19,linolenic:62}, estimated:true },
    { name:'Raspberry seed oil', aliases:[], inci:'Rubus Idaeus (Raspberry) Seed Oil',
      naoh:0.133, koh:0.187, fa:{palmitic:3,stearic:2,oleic:13,linoleic:54,linolenic:25} },
    { name:'Plum kernel oil', aliases:[], inci:'Prunus Domestica Seed Oil',
      naoh:0.138, koh:0.194, fa:{palmitic:4,stearic:1,oleic:68,linoleic:24} },
    { name:'Black seed oil', aliases:[], inci:'Nigella Sativa Seed Oil',
      naoh:0.139, koh:0.195, fa:{palmitic:13,stearic:3,oleic:24,linoleic:58} },
    { name:'Coconut oil, virgin (organic)', aliases:['Coconut oil, virgin'], inci:'Cocos Nucifera (Coconut) Oil',
      naoh:0.183, koh:0.257, fa:{caprylic:7,capric:6,lauric:48,myristic:18,palmitic:9,stearic:3,oleic:7,linoleic:2} },
    { name:'Camellia oil (organic)', aliases:['Camellia oil'], inci:'Camellia Sinensis Seed Oil',
      naoh:0.138, koh:0.193, fa:{palmitic:8,stearic:2,oleic:80,linoleic:8} },
    { name:'Pomegranate oil (organic)', aliases:['Pomegranate oil'], inci:'Punica Granatum Seed Oil',
      naoh:0.135, koh:0.19, fa:{palmitic:3,stearic:2,oleic:5,linoleic:7,linolenic:78} },
    { name:'Marula oil (organic)', aliases:[], inci:'Sclerocarya Birrea Seed Oil',
      naoh:0.137, koh:0.192, fa:{palmitic:10,stearic:7,oleic:70,linoleic:8} },
    { name:'Baobab oil (organic)', aliases:[], inci:'Adansonia Digitata Seed Oil',
      naoh:0.143, koh:0.2, fa:{palmitic:21,stearic:4,oleic:36,linoleic:31,linolenic:2} },
    { name:'Grapeseed oil (organic)', aliases:['Grapeseed oil'], inci:'Vitis Vinifera (Grape) Seed Oil',
      naoh:0.129, koh:0.181, fa:{palmitic:6,stearic:4,oleic:16,linoleic:72} },
    { name:'Pumpkin seed oil (organic)', aliases:['Pumpkin seed oil'], inci:'Cucurbita Pepo Seed Oil',
      naoh:0.139, koh:0.195, fa:{palmitic:13,stearic:7,oleic:34,linoleic:44} },
    { name:'Apricot kernel oil (organic)', aliases:['Apricot kernel oil'], inci:'Prunus Armeniaca Kernel Oil',
      naoh:0.139, koh:0.195, fa:{palmitic:5,stearic:1,oleic:68,linoleic:25} },
    { name:'Olive oil', aliases:[], inci:'Olea Europaea (Olive) Fruit Oil',
      naoh:0.135, koh:0.19, fa:{palmitic:13,stearic:3,oleic:71,linoleic:10,linolenic:1} },
    { name:'Coconut oil (76°)', aliases:['Coconut oil'], inci:'Cocos Nucifera (Coconut) Oil',
      naoh:0.183, koh:0.257, fa:{caprylic:7,capric:6,lauric:48,myristic:18,palmitic:9,stearic:3,oleic:7,linoleic:2} },
    { name:'Palm oil', aliases:[], inci:'Elaeis Guineensis (Palm) Oil',
      naoh:0.142, koh:0.199, fa:{lauric:1,myristic:1,palmitic:44,stearic:5,oleic:39,linoleic:10} },
    { name:'Palm kernel oil', aliases:[], inci:'Elaeis Guineensis (Palm) Kernel Oil',
      naoh:0.176, koh:0.247, fa:{caprylic:3,capric:4,lauric:48,myristic:16,palmitic:8,stearic:2,oleic:15,linoleic:3} },
    { name:'Lard (pork)', aliases:['Lard'], inci:'Lard',
      naoh:0.141, koh:0.198, fa:{myristic:1,palmitic:26,stearic:14,oleic:44,linoleic:10} },
    { name:'Beef tallow', aliases:[], inci:'Tallow',
      naoh:0.143, koh:0.2, fa:{myristic:4,palmitic:26,stearic:22,oleic:38,linoleic:3} },
    { name:'Sunflower oil', aliases:[], inci:'Helianthus Annuus (Sunflower) Seed Oil',
      naoh:0.135, koh:0.189, fa:{palmitic:6,stearic:4,oleic:20,linoleic:68,linolenic:1} },
    { name:'Sunflower oil (high oleic)', aliases:[], inci:'Helianthus Annuus (Sunflower) Seed Oil',
      naoh:0.135, koh:0.189, fa:{palmitic:4,stearic:4,oleic:82,linoleic:4} },
    // Canola IS rapeseed, bred low in erucic acid, so one row answers to both
    // names (Heide, 2026-10-16). The chart's lower "rapeseed, unrefined" figure
    // (0.125) fits old high-erucic rapeseed, whose long-chain acid lowers SAP;
    // the canola sold for cooking and soaping is the low-erucic kind, which is
    // 0.133 and is what this profile predicts.
    { name:'Canola oil (rapeseed)', aliases:['Canola oil','Rapeseed oil'], inci:'Brassica Campestris (Rapeseed) Seed Oil',
      naoh:0.133, koh:0.186, fa:{palmitic:4,stearic:2,oleic:61,linoleic:21,linolenic:11} },
    { name:'Beeswax (soap grade)', aliases:['Beeswax'], inci:'Cera Alba',
      naoh:0.067, koh:0.094, fa:null },
    { name:'Babassu oil', aliases:[], inci:'Orbignya Oleifera Seed Oil',
      naoh:0.175, koh:0.245, fa:{caprylic:4,capric:6,lauric:44,myristic:17,palmitic:9,stearic:3,oleic:14,linoleic:3} },
    { name:'Rice bran oil', aliases:[], inci:'Oryza Sativa (Rice) Bran Oil',
      naoh:0.133, koh:0.187, fa:{palmitic:20,stearic:2,oleic:42,linoleic:32,linolenic:1} },
    { name:'Safflower oil', aliases:[], inci:'Carthamus Tinctorius (Safflower) Seed Oil',
      naoh:0.137, koh:0.192, fa:{palmitic:7,stearic:2,oleic:14,linoleic:75} },
    { name:'Safflower oil (high oleic)', aliases:[], inci:'Carthamus Tinctorius (Safflower) Seed Oil',
      naoh:0.135, koh:0.19, fa:{palmitic:5,stearic:2,oleic:77,linoleic:15} },
    { name:'Sesame oil', aliases:[], inci:'Sesamum Indicum (Sesame) Seed Oil',
      naoh:0.134, koh:0.188, fa:{palmitic:9,stearic:5,oleic:41,linoleic:43} },
    { name:'Soybean oil', aliases:[], inci:'Glycine Soja (Soybean) Oil',
      naoh:0.136, koh:0.191, fa:{palmitic:11,stearic:4,oleic:23,linoleic:54,linolenic:8} },
    { name:'Corn oil', aliases:[], inci:'Zea Mays (Corn) Oil',
      naoh:0.137, koh:0.192, fa:{palmitic:11,stearic:2,oleic:28,linoleic:57,linolenic:1} },
    { name:'Peanut oil', aliases:[], inci:'Arachis Hypogaea (Peanut) Oil',
      naoh:0.137, koh:0.192, fa:{palmitic:11,stearic:3,oleic:48,linoleic:33} },
    { name:'Cottonseed oil', aliases:[], inci:'Gossypium Herbaceum (Cotton) Seed Oil',
      naoh:0.138, koh:0.194, fa:{palmitic:24,stearic:2,oleic:18,linoleic:53} },
    { name:'Olive oil (pomace)', aliases:[], inci:'Olea Europaea (Olive) Husk Oil',
      naoh:0.134, koh:0.188, fa:{palmitic:13,stearic:3,oleic:70,linoleic:10} },
    { name:'Sal butter', aliases:[], inci:'Shorea Robusta Seed Butter',
      naoh:0.132, koh:0.185, fa:{palmitic:6,stearic:44,oleic:39,linoleic:2,arachidic:7} },
    { name:'Illipe butter', aliases:[], inci:'Shorea Stenoptera Seed Butter',
      naoh:0.132, koh:0.185, fa:{palmitic:18,stearic:45,oleic:35,linoleic:1} },
    { name:'Tucuma butter', aliases:[], inci:'Astrocaryum Tucuma Seed Butter',
      naoh:0.17, koh:0.238, fa:{lauric:48,myristic:25,palmitic:6,stearic:2,oleic:13,linoleic:3} },
    { name:'Ucuuba butter', aliases:[], inci:'Virola Surinamensis Seed Butter',
      naoh:null, koh:null, unknown:true, fa:null },
    { name:'Hazelnut oil', aliases:[], inci:'Corylus Avellana (Hazelnut) Seed Oil',
      naoh:0.139, koh:0.195, fa:{palmitic:5,stearic:2,oleic:78,linoleic:12} },
    { name:'Macadamia nut oil', aliases:[], inci:'Macadamia Ternifolia Seed Oil',
      naoh:0.139, koh:0.195, fa:{palmitic:8,palmitoleic:20,stearic:3,oleic:59,linoleic:2} },
    { name:'Walnut oil', aliases:[], inci:'Juglans Regia (Walnut) Seed Oil',
      naoh:0.135, koh:0.189, fa:{palmitic:7,stearic:2,oleic:18,linoleic:60,linolenic:11} },
    { name:'Pecan oil', aliases:[], inci:'Carya Illinoensis (Pecan) Seed Oil',
      naoh:0.135, koh:0.19, fa:{palmitic:7,stearic:2,oleic:52,linoleic:36,linolenic:1} },
    { name:'Brazil nut oil', aliases:[], inci:'Bertholletia Excelsa Seed Oil',
      naoh:0.135, koh:0.19, fa:{palmitic:14,stearic:10,oleic:32,linoleic:41} },
    { name:'Pistachio oil', aliases:[], inci:'Pistacia Vera Seed Oil',
      naoh:0.133, koh:0.186, fa:{palmitic:10,stearic:1,oleic:54,linoleic:31} },
    { name:'Evening primrose oil', aliases:[], inci:'Oenothera Biennis (Evening Primrose) Oil',
      naoh:0.135, koh:0.19, fa:{palmitic:6,stearic:2,oleic:8,linoleic:74,linolenic:10} },
    { name:'Borage oil', aliases:['Borage seed oil'], inci:'Borago Officinalis Seed Oil',
      naoh:0.135, koh:0.19, fa:{palmitic:10,stearic:4,oleic:16,linoleic:38,linolenic:22} },
    { name:'Black currant seed oil', aliases:[], inci:'Ribes Nigrum (Black Currant) Seed Oil',
      naoh:0.135, koh:0.19, fa:{palmitic:6,stearic:2,oleic:10,linoleic:47,linolenic:30} },
    { name:'Cranberry seed oil', aliases:[], inci:'Vaccinium Macrocarpon (Cranberry) Seed Oil',
      naoh:0.135, koh:0.19, fa:{palmitic:6,stearic:1,oleic:22,linoleic:44,linolenic:25} },
    { name:'Flax seed oil (linseed)', aliases:['Flax seed oil','Flaxseed oil'], inci:'Linum Usitatissimum (Linseed) Seed Oil',
      naoh:0.135, koh:0.19, fa:{palmitic:6,stearic:4,oleic:19,linoleic:15,linolenic:55} },
    { name:'Moringa oil', aliases:[], inci:'Moringa Oleifera Seed Oil',
      naoh:0.137, koh:0.192, fa:{palmitic:7,stearic:5,oleic:72,linoleic:1,behenic:6} },
    { name:'Neem seed oil', aliases:[], inci:'Melia Azadirachta Seed Oil',
      naoh:0.138, koh:0.193, fa:{palmitic:18,stearic:18,oleic:45,linoleic:15} },
    { name:'Karanja oil', aliases:[], inci:'Pongamia Glabra Seed Oil',
      naoh:0.13, koh:0.183, fa:{palmitic:11,stearic:7,oleic:52,linoleic:18,behenic:4} },
    { name:'Kukui nut oil', aliases:[], inci:'Aleurites Moluccana Seed Oil',
      naoh:0.135, koh:0.189, fa:{palmitic:6,stearic:2,oleic:20,linoleic:42,linolenic:29} },
    { name:'Wheat germ oil', aliases:[], inci:'Triticum Vulgare (Wheat) Germ Oil',
      naoh:0.13, koh:0.183, fa:{palmitic:17,stearic:2,oleic:16,linoleic:56,linolenic:7} },
    { name:'Sacha inchi oil', aliases:[], inci:'Plukenetia Volubilis Seed Oil',
      naoh:0.134, koh:0.188, fa:{palmitic:4,stearic:3,oleic:9,linoleic:36,linolenic:48} },
    { name:'Broccoli seed oil', aliases:[], inci:'Brassica Oleracea Italica Seed Oil',
      naoh:0.123, koh:0.172, fa:{palmitic:3,stearic:1,oleic:13,linoleic:11,linolenic:9,behenic:1,erucic:49,gadoleic:6} },
    { name:'Abyssinian oil', aliases:[], inci:'Crambe Abyssinica Seed Oil',
      naoh:0.12, koh:0.168, fa:{palmitic:2,oleic:15,linoleic:9,linolenic:6,erucic:58} },
    { name:'Emu oil', aliases:[], inci:'Emu Oil',
      naoh:0.135, koh:0.19, fa:{palmitic:22,stearic:9,oleic:45,linoleic:15} },
    { name:'Stearic acid', aliases:[], inci:'Stearic Acid',
      naoh:0.141, koh:0.198, fa:null },
    { name:'Candelilla wax', aliases:[], inci:'Euphorbia Cerifera (Candelilla) Wax',
      naoh:0.031, koh:0.044, fa:null },
    { name:'Lanolin', aliases:[], inci:'Lanolin',
      naoh:0.076, koh:0.106, fa:null },
    { name:'Aloe butter', aliases:[], inci:'Aloe Barbadensis Leaf Extract (and) Cocos Nucifera Oil',
      naoh:0.171, koh:0.24, fa:null },
  ];

  // Lowercase, drop punctuation and collapse spaces, so "Coconut oil (76°)",
  // "coconut oil 76" and "Coconut Oil, 76 deg" all reduce to one key.
  function norm(s) {
    if (!s) return '';
    return String(s).toLowerCase()
      .replace(/\u00b0/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\bdeg(rees)?\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Built once. A primary name always wins over an alias that reduces to the
  // same key, so adding an alias can never steal another oil's lookup.
  var INDEX = (function () {
    var ix = {}, i, j, o, k;
    for (i = 0; i < OILS.length; i++) {
      k = norm(OILS[i].name);
      if (k) ix[k] = OILS[i];
    }
    for (i = 0; i < OILS.length; i++) {
      o = OILS[i];
      for (j = 0; j < o.aliases.length; j++) {
        k = norm(o.aliases[j]);
        if (k && ix[k] === undefined) ix[k] = o;
      }
    }
    return ix;
  })();

  function lookup(name) {
    var o = INDEX[norm(name)];
    return o === undefined ? null : o;
  }

  function all() { return OILS.slice(); }

  return {
    version: '1.2',
    source:  'SoapCalc chart (KOH first, NaOH second)',
    oils:    all,
    lookup:  lookup,
    count:   OILS.length,
    _norm:   norm
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = PlumeSap; }
