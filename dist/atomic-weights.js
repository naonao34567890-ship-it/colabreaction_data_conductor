/* CIAAW Standard Atomic Weights 2024, retrieved 2026-11-13.
 * https://www.ciaaw.org/atomic-weights.htm
 * Interval endpoints are retained; parenthetical uncertainties are not isotope ranges.
 */
(function(root){
'use strict';
const version='CIAAW-2024-v1';
const weights={
 "H": {
  "lower": "1.00784",
  "upper": "1.00811",
  "notation": "[1.007 84, 1.008 11]"
 },
 "He": {
  "lower": "4.002602",
  "upper": "4.002602",
  "notation": "4.002 602(2)"
 },
 "Li": {
  "lower": "6.938",
  "upper": "6.997",
  "notation": "[6.938, 6.997]"
 },
 "Be": {
  "lower": "9.0121831",
  "upper": "9.0121831",
  "notation": "9.012 1831(5)"
 },
 "B": {
  "lower": "10.806",
  "upper": "10.821",
  "notation": "[10.806, 10.821]"
 },
 "C": {
  "lower": "12.0096",
  "upper": "12.0116",
  "notation": "[12.0096, 12.0116]"
 },
 "N": {
  "lower": "14.00643",
  "upper": "14.00728",
  "notation": "[14.006 43, 14.007 28]"
 },
 "O": {
  "lower": "15.99903",
  "upper": "15.99977",
  "notation": "[15.999 03, 15.999 77]"
 },
 "F": {
  "lower": "18.998403162",
  "upper": "18.998403162",
  "notation": "18.998 403 162(5)"
 },
 "Ne": {
  "lower": "20.1797",
  "upper": "20.1797",
  "notation": "20.1797(6)"
 },
 "Na": {
  "lower": "22.98976928",
  "upper": "22.98976928",
  "notation": "22.989 769 28(2)"
 },
 "Mg": {
  "lower": "24.304",
  "upper": "24.307",
  "notation": "[24.304, 24.307]"
 },
 "Al": {
  "lower": "26.9815384",
  "upper": "26.9815384",
  "notation": "26.981 5384(3)"
 },
 "Si": {
  "lower": "28.084",
  "upper": "28.086",
  "notation": "[28.084, 28.086]"
 },
 "P": {
  "lower": "30.973761998",
  "upper": "30.973761998",
  "notation": "30.973 761 998(5)"
 },
 "S": {
  "lower": "32.059",
  "upper": "32.076",
  "notation": "[32.059, 32.076]"
 },
 "Cl": {
  "lower": "35.446",
  "upper": "35.457",
  "notation": "[35.446, 35.457]"
 },
 "Ar": {
  "lower": "39.792",
  "upper": "39.963",
  "notation": "[39.792, 39.963]"
 },
 "K": {
  "lower": "39.0983",
  "upper": "39.0983",
  "notation": "39.0983(1)"
 },
 "Ca": {
  "lower": "40.078",
  "upper": "40.078",
  "notation": "40.078(4)"
 },
 "Sc": {
  "lower": "44.955907",
  "upper": "44.955907",
  "notation": "44.955 907(4)"
 },
 "Ti": {
  "lower": "47.867",
  "upper": "47.867",
  "notation": "47.867(1)"
 },
 "V": {
  "lower": "50.9415",
  "upper": "50.9415",
  "notation": "50.9415(1)"
 },
 "Cr": {
  "lower": "51.9961",
  "upper": "51.9961",
  "notation": "51.9961(6)"
 },
 "Mn": {
  "lower": "54.938043",
  "upper": "54.938043",
  "notation": "54.938 043(2)"
 },
 "Fe": {
  "lower": "55.845",
  "upper": "55.845",
  "notation": "55.845(2)"
 },
 "Co": {
  "lower": "58.933194",
  "upper": "58.933194",
  "notation": "58.933 194(3)"
 },
 "Ni": {
  "lower": "58.6934",
  "upper": "58.6934",
  "notation": "58.6934(4)"
 },
 "Cu": {
  "lower": "63.546",
  "upper": "63.546",
  "notation": "63.546(3)"
 },
 "Zn": {
  "lower": "65.38",
  "upper": "65.38",
  "notation": "65.38(2)"
 },
 "Ga": {
  "lower": "69.723",
  "upper": "69.723",
  "notation": "69.723(1)"
 },
 "Ge": {
  "lower": "72.630",
  "upper": "72.630",
  "notation": "72.630(8)"
 },
 "As": {
  "lower": "74.921595",
  "upper": "74.921595",
  "notation": "74.921 595(6)"
 },
 "Se": {
  "lower": "78.971",
  "upper": "78.971",
  "notation": "78.971(8)"
 },
 "Br": {
  "lower": "79.901",
  "upper": "79.907",
  "notation": "[79.901, 79.907]"
 },
 "Kr": {
  "lower": "83.798",
  "upper": "83.798",
  "notation": "83.798(2)"
 },
 "Rb": {
  "lower": "85.4678",
  "upper": "85.4678",
  "notation": "85.4678(3)"
 },
 "Sr": {
  "lower": "87.62",
  "upper": "87.62",
  "notation": "87.62(1)"
 },
 "Y": {
  "lower": "88.905838",
  "upper": "88.905838",
  "notation": "88.905 838(2)"
 },
 "Zr": {
  "lower": "91.222",
  "upper": "91.222",
  "notation": "91.222(3)"
 },
 "Nb": {
  "lower": "92.90637",
  "upper": "92.90637",
  "notation": "92.906 37(1)"
 },
 "Mo": {
  "lower": "95.95",
  "upper": "95.95",
  "notation": "95.95(1)"
 },
 "Tc": null,
 "Ru": {
  "lower": "101.07",
  "upper": "101.07",
  "notation": "101.07(2)"
 },
 "Rh": {
  "lower": "102.90549",
  "upper": "102.90549",
  "notation": "102.905 49(2)"
 },
 "Pd": {
  "lower": "106.42",
  "upper": "106.42",
  "notation": "106.42(1)"
 },
 "Ag": {
  "lower": "107.8682",
  "upper": "107.8682",
  "notation": "107.8682(2)"
 },
 "Cd": {
  "lower": "112.414",
  "upper": "112.414",
  "notation": "112.414(4)"
 },
 "In": {
  "lower": "114.818",
  "upper": "114.818",
  "notation": "114.818(1)"
 },
 "Sn": {
  "lower": "118.710",
  "upper": "118.710",
  "notation": "118.710(7)"
 },
 "Sb": {
  "lower": "121.760",
  "upper": "121.760",
  "notation": "121.760(1)"
 },
 "Te": {
  "lower": "127.60",
  "upper": "127.60",
  "notation": "127.60(3)"
 },
 "I": {
  "lower": "126.90447",
  "upper": "126.90447",
  "notation": "126.904 47(3)"
 },
 "Xe": {
  "lower": "131.293",
  "upper": "131.293",
  "notation": "131.293(6)"
 },
 "Cs": {
  "lower": "132.90545196",
  "upper": "132.90545196",
  "notation": "132.905 451 96(6)"
 },
 "Ba": {
  "lower": "137.327",
  "upper": "137.327",
  "notation": "137.327(7)"
 },
 "La": {
  "lower": "138.90547",
  "upper": "138.90547",
  "notation": "138.905 47(7)"
 },
 "Ce": {
  "lower": "140.116",
  "upper": "140.116",
  "notation": "140.116(1)"
 },
 "Pr": {
  "lower": "140.90766",
  "upper": "140.90766",
  "notation": "140.907 66(1)"
 },
 "Nd": {
  "lower": "144.242",
  "upper": "144.242",
  "notation": "144.242(3)"
 },
 "Pm": null,
 "Sm": {
  "lower": "150.36",
  "upper": "150.36",
  "notation": "150.36(2)"
 },
 "Eu": {
  "lower": "151.964",
  "upper": "151.964",
  "notation": "151.964(1)"
 },
 "Gd": {
  "lower": "157.249",
  "upper": "157.249",
  "notation": "157.249(2)"
 },
 "Tb": {
  "lower": "158.925354",
  "upper": "158.925354",
  "notation": "158.925 354(7)"
 },
 "Dy": {
  "lower": "162.500",
  "upper": "162.500",
  "notation": "162.500(1)"
 },
 "Ho": {
  "lower": "164.930329",
  "upper": "164.930329",
  "notation": "164.930 329(5)"
 },
 "Er": {
  "lower": "167.259",
  "upper": "167.259",
  "notation": "167.259(3)"
 },
 "Tm": {
  "lower": "168.934219",
  "upper": "168.934219",
  "notation": "168.934 219(5)"
 },
 "Yb": {
  "lower": "173.045",
  "upper": "173.045",
  "notation": "173.045(10)"
 },
 "Lu": {
  "lower": "174.96669",
  "upper": "174.96669",
  "notation": "174.966 69(5)"
 },
 "Hf": {
  "lower": "178.486",
  "upper": "178.486",
  "notation": "178.486(6)"
 },
 "Ta": {
  "lower": "180.94788",
  "upper": "180.94788",
  "notation": "180.947 88(2)"
 },
 "W": {
  "lower": "183.84",
  "upper": "183.84",
  "notation": "183.84(1)"
 },
 "Re": {
  "lower": "186.207",
  "upper": "186.207",
  "notation": "186.207(1)"
 },
 "Os": {
  "lower": "190.23",
  "upper": "190.23",
  "notation": "190.23(3)"
 },
 "Ir": {
  "lower": "192.217",
  "upper": "192.217",
  "notation": "192.217(2)"
 },
 "Pt": {
  "lower": "195.084",
  "upper": "195.084",
  "notation": "195.084(9)"
 },
 "Au": {
  "lower": "196.966570",
  "upper": "196.966570",
  "notation": "196.966 570(4)"
 },
 "Hg": {
  "lower": "200.592",
  "upper": "200.592",
  "notation": "200.592(3)"
 },
 "Tl": {
  "lower": "204.382",
  "upper": "204.385",
  "notation": "[204.382, 204.385]"
 },
 "Pb": {
  "lower": "206.14",
  "upper": "207.94",
  "notation": "[206.14, 207.94]"
 },
 "Bi": {
  "lower": "208.98040",
  "upper": "208.98040",
  "notation": "208.980 40(1)"
 },
 "Po": null,
 "At": null,
 "Rn": null,
 "Fr": null,
 "Ra": null,
 "Ac": null,
 "Th": {
  "lower": "232.0377",
  "upper": "232.0377",
  "notation": "232.0377(4)"
 },
 "Pa": {
  "lower": "231.03588",
  "upper": "231.03588",
  "notation": "231.035 88(1)"
 },
 "U": {
  "lower": "238.02891",
  "upper": "238.02891",
  "notation": "238.028 91(3)"
 },
 "Np": null,
 "Pu": null,
 "Am": null,
 "Cm": null,
 "Bk": null,
 "Cf": null,
 "Es": null,
 "Fm": null,
 "Md": null,
 "No": null,
 "Lr": null,
 "Rf": null,
 "Db": null,
 "Sg": null,
 "Bh": null,
 "Hs": null,
 "Mt": null,
 "Ds": null,
 "Rg": null,
 "Cn": null,
 "Nh": null,
 "Fl": null,
 "Mc": null,
 "Lv": null,
 "Ts": null,
 "Og": null
};
const scale=1000000000000n;
function scaled(value){const [a,b='']=value.split('.');return BigInt(a)*scale+BigInt(b.padEnd(12,'0'));}
function rounded(value){const n=(value+50000000n)/100000000n;return (n/10000n)+'.'+String(n%10000n).padStart(4,'0');}
function calculate(atoms){
 let low=0n,high=0n;const missing=new Set();
 for(const atom of atoms){
  const w=weights[atom.el];
  if(!w){missing.add(atom.el);continue;}
  low+=scaled(w.lower);high+=scaled(w.upper);
 }
 if(missing.size)return {version,missing:[...missing].sort(),text:'',key:null};
 const a=rounded(low),b=rounded(high);
 return {version,lower:low.toString(),upper:high.toString(),key:(low+high).toString(),text:a===b?a:a+'–'+b};
}
function valid(m){return m?.version===version && (m.key===null||/^\d+$/.test(m.key)) && typeof m.text==='string';}
function compare(a,b,descending=false){
 const x=a.mass,y=b.mass,hasA=valid(x)&&x.key!==null,hasB=valid(y)&&y.key!==null;
 if(hasA!==hasB)return hasA?-1:1;
 if(!hasA)return 0;
 const first=BigInt(x.key),second=BigInt(y.key),order=first<second?-1:first>second?1:0;
 return descending?-order:order;
}
const api={version,weights,calculate,valid,compare};
root.MolMass=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
