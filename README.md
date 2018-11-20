# mapeo-core

[![Build
Status](https://travis-ci.org/digidem/mapeo-core.svg?branch=master)](https://travis-ci.org/digidem/mapeo-core)

Offline p2p mapping library.


```
npm install mapeo-core
```

## API

```
var Mapeo = require('mapeo-core')
```

### `mapeo = new Mapeo(osm, media, opts)`

* `osm`: an `osm-p2p-db` instance
* `media`: a blob storage instance
* `opts`: options

### `mapeo.observationCreate(obs, cb)`

Create an observation. 

Validated fields:

  * `type`: (required) must be the string literal `"observation"`
  * `attachments`: (optional) array of attachments, each with an `id`.
  * `lat`: (required) latitude
  * `lon`: (required) longitude

### `mapeo.observationGet(id, cb)`

Get the observation with the given id.

### `mapeo.observationUpdate(newObservation, cb)`

Update the observation. It requires valid `version` and `id` fields that
reference the observation you are updating.

### `mapeo.observationDelete(id, cb)`

Delete the observation with the given id.

### `mapeo.observationList(cb)`

Returns an array of observations to the given `callback`. Any errors are
propagated as the first argument to the callback.

### `mapeo.observationStream()`

Returns a stream of observations.

### `mapeo.observationConvert(obs, cb)`

Convert an observation to an OSM type `node`.

### `mapeo.close()

## License

MIT
