'use strict';
const fs = require('node:fs');
const satellite = require('satellite.js');
const { cellCenter } = require('../public/hex.js');

/** Elevation in degrees of a satellite as seen from a point, or null if the propagation fails. */
function elevationDeg(tle, observer, at) {
  const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
  const pv = satellite.propagate(satrec, at);
  if (!pv || !pv.position) return null;
  const gmst = satellite.gstime(at);
  const look = satellite.ecfToLookAngles(
    {
      latitude: satellite.degreesToRadians(observer.latitudeDeg),
      longitude: satellite.degreesToRadians(observer.longitudeDeg),
      height: (observer.heightKm || 0),
    },
    satellite.eciToEcf(pv.position, gmst)
  );
  return satellite.radiansToDegrees(look.elevation);
}

/** Highest elevation reached between two instants, sampled every `stepSec`. */
function maxElevationDeg(tle, observer, startMs, endMs, stepSec = 10) {
  let best = -90;
  for (let t = startMs; t <= endMs; t += stepSec * 1000) {
    const e = elevationDeg(tle, observer, new Date(t));
    if (e !== null && e > best) best = e;
  }
  return best;
}

/** Loads { "<noradId>": { line1, line2 } } from a JSON file. Missing file means no orbit data. */
function fileTleProvider(path) {
  return (noradId) => {
    try {
      const all = JSON.parse(fs.readFileSync(path, 'utf8'));
      return all[noradId] || null;
    } catch {
      return null;
    }
  };
}

/**
 * Physics check for a satellite-pass report: could this satellite really have been over this place during the
 * claimed window? Returns problems, empty when the claim is consistent with the orbit.
 */
function checkPassPhysics(report, tleFor) {
  const problems = [];
  const pass = report.pass;
  const tle = tleFor(pass.noradId);
  if (!tle) return ['no orbit data for this satellite, so the pass cannot be checked'];

  const first = report.buckets[0];
  const observer = cellCenter(first.cellId);
  if (!observer) return ['report has no usable location'];

  const predicted = maxElevationDeg(tle, observer, pass.startMs, pass.endMs);
  if (predicted < 5) problems.push(`the satellite was not above the horizon here during that window (predicted peak ${predicted.toFixed(0)}°)`);
  else if (Math.abs(predicted - pass.maxElevationDeg) > 12) {
    problems.push(`claimed peak elevation ${pass.maxElevationDeg.toFixed(0)}° does not match the orbit (predicted ${predicted.toFixed(0)}°)`);
  }
  return problems;
}

module.exports = { elevationDeg, maxElevationDeg, fileTleProvider, checkPassPhysics };
