# MIT-BIH validation of the irregular-beat detector

```
node validate.mjs
```

What the script does:
1. Downloads the 44 non-paced MIT-BIH beat-label files from PhysioNet into `data/` the first time (about 324 KB).
2. Runs the app's own `astro-health/js/band.js` on them.
3. Prints sensitivity, precision, false alarms and rate agreement.
4. Writes `results.json`.

Needs Node 18 or newer. Results and what they mean are in [`docs/VALIDATION-MITBIH.md`](../../docs/VALIDATION-MITBIH.md).
