# @mapeo/core

[![Build
Status](https://travis-ci.org/digidem/mapeo-core.svg?branch=master)](https://travis-ci.org/digidem/mapeo-core)

Offline p2p mapping library.


```
npm install @mapeo/core
```

## API

```
var Mapeo = require('@mapeo/core')
```

### `mapeo = new Mapeo(osm, media, opts)`

* `osm`: an [osm-p2p](http://github.com/digidem/kappa-osm) (or [kappa-osm](http://github.com/digidem/kappa-osm)) instance
* `media`: a blob storage instance (e.g., [safe-fs-blob-store](http://npmjs.com/safe-fs-blob-store))
* `opts`: options

Valid `opts` options include:
- `opts.deviceType` (string): one of `{'desktop', 'mobile'}`. This affects how sync works. Mobile targets will not receive full-resolution media from other devices, but share them *to* desktop devices.

## Observations API 

A observation is a point on the map with particular metadata. 

See the [spec].. 

Validated fields:

  * `type`: (required) must be the string literal `"observation"`
  * `attachments`: (optional) array of attachments, each with an `id`.
  * `lat`: (required) latitude
  * `lon`: (required) longitude

### `mapeo.observationCreate(obs, cb)`

Create an observation. 

### `mapeo.observationGet(id, cb)`

Get the observation with the given id.

### `mapeo.observationUpdate(newObservation, cb)`

Update the observation. It requires valid `version` and `id` fields that
reference the observation you are updating.

### `mapeo.observationDelete(id, cb)`

Delete the observation with the given id.

### `mapeo.observationStream(opts)`

Returns a stream of observations. Options for filtering the data can be passed
according to the [levelup createReadStream
API](https://github.com/Level/levelup#createReadStream).

### `mapeo.observationList(opts, cb)`

Returns an array of observations to the given `callback`. Any errors are
propagated as the first argument to the callback. Same options accepted as
`mapeo.observationStream`.

### `mapeo.observationConvert(obs, cb)`

Convert an observation to an OSM type `node`.

### `mapeo.close()

## Sync API

Mapeo core provides some key functionality for syncing between two devices over
WiFi and filesystem (i.e., over USB sneakernets).

`const sync = mapeo.sync`

```js
var sync = mapeo.sync

sync.listen(function () {
  
})
```

### sync.listen(cb)

Broadcast and listen on the local network for peers. `cb` is called once the service is up and broadcasting.

### sync.close(cb)

Unannounces the sync service & cleans up the underlying UDP socket. `cb` is called once this is complete.

### sync.targets()

Fetch a list of the current sync targets that have been found thus far.

A target can have the following properties:

  * `name`: a human-readable identifier for the target (e.g., hostname)
  * `host`: the ip
  * `port`: the port
  * `type`: 'wifi' or 'file'
  
### sync.on('target', target)

Emitted when a new wifi target is discovered.

### var ev = sync.start(target)

`target` is an object with properties `host`, `port`, and `name`.

An EventEmitter `ev` is returned. It can emit

- `"error"`: gives an Error object signalling an error in syncing.
- `"progress"`: gives a string describing the current sync state.
- `"end"`: successful completion of OSM and media sync.

### var ev = sync.replicateFromFile(filepath)

`filepath` is a string specifying where the find the file to sync with. If it doesn't exist, it will be created, and use the format specified in the constructor's `opts.writeFormat`.

An EventEmitter `ev` is returned. It can emit

- `"error"`: gives an Error object signalling an error in syncing.
- `"progress"`: gives a string describing the current sync state.
- `"end"`: successful completion of OSM and media sync.

## License

MIT
