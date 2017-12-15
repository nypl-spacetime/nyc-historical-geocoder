#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const R = require('ramda')
const H = require('highland')
const lunr = require('lunr')
const levenshtein = require('fast-levenshtein')
const normalizer = require('@spacetime/nyc-street-normalizer')

const DEFAULT_CONFIG = {
  borough: 'Manhattan',
  streets: 'nyc-streets',
  addresses: 'addresses'
}

function getObjectStream (filename) {
  return H(fs.createReadStream(filename))
    .split()
    .compact()
    .map(JSON.parse)
}

function cleanAddress (address) {
  return address.replace(/[^0-9a-z\., ½\-'&]/gi, '').trim()
}

function objectsFilename (datasetDir, datasetId) {
  return path.join(datasetDir, datasetId, `${datasetId}.objects.ndjson`)
}

function expandId (datasetId, id) {
  if (String(id).includes('/')) {
    return id
  } else {
    return `${datasetId}/${id}`
  }
}

function parseAddress (address) {
  const match = /^([\d½]+) (.*)/i.exec(address)

  if (!match) {
    throw new Error('Address does not start with a number')
  }

  const [, number, street] = match

  if (!street.length) {
    throw new Error('Address does not contain street name')
  }

  return {
    number,
    street
  }
}

function indexStreets (filename) {
  let count = 0
  const indices = {}
  const allStreets = {}

  return new Promise((resolve, reject) => {
    getObjectStream(filename)
      .map((street) => ({
        id: street.id,
        validSince: street.validSince,
        validUntil: street.validUntil,
        name: normalizer(street.name),
        borough: street.data && street.data.borough
      }))
      .map((street) => {
        if (!street.borough) {
          throw new Error(`Street found without borough: ${street.id}`)
        }

        return street
      })
      .stopOnError(reject)
      .group('borough')
      .map(R.toPairs)
      .sequence()
      .each((boroughStreets) => {
        const [borough, streets] = boroughStreets
        let boroughCount = 0

        const index = lunr(function () {
          this.ref('index')
          this.field('name')

          streets.forEach((street) => {
            this.add(Object.assign(street, {
              index: boroughCount
            }))

            count += 1
            boroughCount += 1
          })
        })

        indices[borough] = index
        allStreets[borough] = streets
      })
      .done(() => {
        console.log(`  Indexed ${count} streets`)

        resolve({
          search: (str, borough) => {
            if (indices[borough]) {
              const index = indices[borough]
              return index.search(str)
                .map((result) => allStreets[borough][result.ref])
            }
          }
        })
      })
  })
}

function indexAddresses (filename) {
  let count = 0
  const addresses = {}

  return new Promise((resolve, reject) => {
    getObjectStream(filename)
      .each((address) => {
        count += 1

        const borough = address.data && address.data.borough

        if (!borough) {
          throw new Error(`Address found without borough: ${address.id}`)
        }

        if (!addresses[borough]) {
          addresses[borough] = {}
        }

        addresses[borough][address.name] = {
          id: address.id,
          name: address.name,
          validSince: address.validSince,
          validUntil: address.validUntil,
          geometry: address.geometry
        }
      })
      .stopOnError(reject)
      .done(() => {
        console.log(`  Indexed ${count} addresses`)
        resolve({
          search: (str, borough) => addresses[borough] && addresses[borough][str]
        })
      })
  })
}

function Geocoder (indices, config) {
  function findStreet (street, borough) {
    const normalized = normalizer(street)

    const editDistancePerWord = 2
    const searchStr = normalized.split(' ')
      .map((word) => {
        if (word.length < 2) {
          return
        } else if (word.length <= 3 || word.match(/^\d/)) {
          return word
        }

        return `${word}~${editDistancePerWord}`
      })
      .filter(R.identity)
      .join(' ')

    let results
    try {
      results = indices.streets.search(searchStr, borough)
    } catch (err) {
      throw new Error(`Error searching lunr.js: "${err.message}"`)
    }

    if (!results.length) {
      throw new Error(`No results for street: ${normalized}`)
    }

    const bestResults = results
      .map((result) => Object.assign(result, {
        distance: levenshtein.get(normalized, result.name)
      }))
      .filter((result) => result.distance <= 2)
      .sort((a, b) => a.distance - b.distance)

    if (bestResults.length) {
      const foundStreet = bestResults[0]
      return R.omit(['index', 'distance', 'borough'], foundStreet)
    } else {
      throw new Error(`Street not found: ${normalized}`)
    }
  }

  function findAddress (address, borough) {
    const foundAddress = indices.addresses.search(address, borough)

    if (!foundAddress) {
      throw new Error(`Address not found: ${address}`)
    }

    return foundAddress
  }

  function geocode (address, borough) {
    borough = borough || config.borough

    if (!borough) {
      throw new Error('Borough parameter not set')
    }

    const cleanedAddress = cleanAddress(address)
    const parsedAddress = parseAddress(cleanedAddress)

    const foundStreet = findStreet(parsedAddress.street, borough)

    const normalizedAddress = `${parsedAddress.number} ${foundStreet.name}`
    const foundAddress = findAddress(normalizedAddress, borough)

    return {
      type: 'Feature',
      properties: {
        input: address,
        borough,
        street: Object.assign(foundStreet, {
          id: expandId(config.streets, foundStreet.id)
        }),
        address: Object.assign(R.omit(['geometry'], foundAddress), {
          id: expandId(config.addresses, foundAddress.id)
        })
      },
      geometry: foundAddress.geometry
    }
  }

  return geocode
}

function initialize (userConfig) {
  const config = Object.assign(DEFAULT_CONFIG, userConfig)

  if (!config.datasetDir) {
    throw new Error('datasetDir not set in configuration')
  }

  if (!config.streets) {
    throw new Error('streets not set in configuration')
  }

  if (!config.addresses) {
    throw new Error('addresses not set in configuration')
  }

  const streetsFilename = objectsFilename(config.datasetDir, config.streets)
  const addressesFilename = objectsFilename(config.datasetDir, config.addresses)

  if (!fs.existsSync(streetsFilename)) {
    throw new Error(`File does not exist: ${streetsFilename}`)
  }

  if (!fs.existsSync(addressesFilename)) {
    throw new Error(`File does not exist: ${addressesFilename}`)
  }

  return new Promise((resolve, reject) => {
    Promise.all([indexStreets(streetsFilename), indexAddresses(addressesFilename)])
      .then((indexArray) => {
        const [streets, addresses] = indexArray

        const indices = {
          streets,
          addresses
        }

        resolve(Geocoder(indices, config))
      })
      .catch(reject)
  })
}

if (require.main === module) {
  const argv = require('minimist')(process.argv.slice(2), {
    alias: {
      borough: 'b',
      datasetDir: 'd',
      streets: 's',
      addresses: 'a'
    },
    default: DEFAULT_CONFIG
  })

  initialize({
    datasetDir: argv.datasetDir,
    streetsDataset: argv.streets,
    addressesDataset: argv.addresses
  })
  .then((geocoder) => {
    const addresses = argv._

    addresses
      .forEach((address) => {
        console.log(`Geocoding "${address}":`)
        try {
          const result = geocoder(address, argv.borough)

          if (result) {
            console.log(JSON.stringify(result, null, 2))
          }
        } catch (err) {
          console.error(`  Error: ${err.message}`)
        }
      })
  }).catch((err) => {
    console.error('Error initializing historical geocoder:')
    console.error(err.message)
  })
}

module.exports = initialize
