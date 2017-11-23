# nyc-historical-geocoder

Geocoder for historical New York City addresses, for Node.js.

This module is part of NYPL’s [NYC Space/Time Directory](http://spacetime.nypl.org).

nyc-historical-geocoder uses [Lunr](https://lunrjs.com/) to index historical addresses and streets from the following two datasets:

- [`nyc-streets`](http://spacetime.nypl.org/#data-nyc-streets)
- [`addresses`](http://spacetime.nypl.org/#data-addresses)

To use nyc-historical-geocoder, you must download these two datasets, set the `datasetDir` configuration option to the path of the directory containing these datasets.

For more information on those two datasets, see our [tutorial on historical addresses](https://github.com/nypl-spacetime/tutorial-historical-addresses).

## Usage & Installation

### In Node.js

First, install the geocoder:

    npm install nypl-spacetime/nyc-historical-geocoder

Example code:

```js
const Geocoder = require('@spacetime/nyc-historical-geocoder')

const config = {
  datasetDir: '/path/to/datasets',
  borough: 'Brooklyn', // Default: 'Manhattan'
  streets: 'nyc-streets', // Default: 'nyc-streets'
  addresses: 'addresses' // Default: 'addresses'
}

Geocoder(config)
  .then((geocoder) => {
    const result = geocoder('34 Talman Street')
    console.log(result)
  })
  .catch((err) => {
    console.error(err)
  })
```

### From the command line

First, install the geocoder:

    npm install -g nypl-spacetime/nyc-historical-geocoder

Geocode _"34 Talman Street"_:

    nyc-historical-geocoder -b Brooklyn -d /path/to/datasets/ "34 Talman Street"

Output:

```json
{
  "type": "Feature",
  "properties": {
    "input": "34 Talman",
    "borough": "Brooklyn",
    "street": {
      "id": "nyc-streets/860-talman-street",
      "validSince": 1855,
      "validUntil": 1855,
      "name": "Talman Street"
    },
    "address": {
      "id": "addresses/143255-1",
      "name": "34 Talman Street",
      "validSince": 1855,
      "validUntil": 1855
    }
  },
  "geometry": {
    "type": "Point",
    "coordinates": [
      -73.98520812392233,
      40.70100675808166
    ]
  }
}
```

Command line options:

- Dataset directory: `--datasetDir`, `-d`
- Borough: `--borough`, `-b` (default: `Manhattan`)
- Streets dataset: `--streets`, `-s` (default: `nyc-streets`)
- Addresses dataset: `--addresses`, `-a` (default: `addresses`)
