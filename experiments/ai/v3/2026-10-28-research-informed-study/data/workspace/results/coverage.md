# Teacher coverage audit

Raw positions: 12453; excluded certified-loss: 67; training: 9263; validation: 3123.
Eligible training positions with >=1% mass outside top2: 9155/9263 (98.83%); skip Soft4: False.

| Split / board | Teacher top8 mass | Teacher top8 recall | Common target top8 mass | Common target top8 recall | Mean support |
| --- | ---: | ---: | ---: | ---: | ---: |
| train/board/sphere3 | 0.9322 | 0.9572 | 0.9322 | 0.9572 | 28.4733 |
| train/board/sphere4 | 0.9166 | 0.9469 | 0.9166 | 0.9469 | 49.9867 |
| train/board/sphere5 | 0.9105 | 0.9423 | 0.9105 | 0.9423 | 76.7167 |
| train/board/torus7 | 0.9149 | 0.9419 | 0.9149 | 0.9419 | 24.6541 |
| train/board/torus9 | 0.8801 | 0.9093 | 0.8801 | 0.9093 | 41.8398 |
| train/board/torus11 | 0.8976 | 0.9286 | 0.8976 | 0.9286 | 61.8666 |
| train/board/plane7 | 0.8909 | 0.9334 | 0.8909 | 0.9334 | 27.1919 |
| train/board/plane9 | 0.7456 | 0.8060 | 0.7456 | 0.8060 | 44.8581 |
| train/board/plane11 | 0.6614 | 0.7384 | 0.6614 | 0.7384 | 66.4577 |
| validation/board/sphere3 | 0.9305 | 0.9597 | 0.9305 | 0.9597 | 28.6694 |
| validation/board/sphere4 | 0.9127 | 0.9368 | 0.9127 | 0.9368 | 51.7316 |
| validation/board/sphere5 | 0.9104 | 0.9470 | 0.9104 | 0.9470 | 79.0430 |
| validation/board/torus7 | 0.9086 | 0.9307 | 0.9086 | 0.9307 | 26.5347 |
| validation/board/torus9 | 0.9071 | 0.9467 | 0.9071 | 0.9467 | 41.5976 |
| validation/board/torus11 | 0.8831 | 0.9240 | 0.8831 | 0.9240 | 60.8593 |
| validation/board/plane7 | 0.8280 | 0.8718 | 0.8280 | 0.8718 | 27.7205 |
| validation/board/plane9 | 0.7663 | 0.8266 | 0.7663 | 0.8266 | 44.9904 |
| validation/board/plane11 | 0.6244 | 0.6993 | 0.6244 | 0.6993 | 65.7763 |

Training policy and common-validation policy are reported separately. Zero-probability moves cannot be recovered by power softening. Shared feature fingerprints from independent origin games are descriptive, not evidence of origin leakage. Full legality and labels were validated by the production training loader.
