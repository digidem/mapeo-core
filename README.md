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
- `opts.deviceType` (string): one of `{'desktop', 'mobile'}`. This affects how sync works. Mobile peers will not receive full-resolution media from other devices, but share them *to* desktop devices.

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

Delete the observation with the given id. Also deletes attached media.

### `mapeo.observationStream(opts)`

Returns a stream of observations. Options for filtering the data can be passed
according to the [levelup createReadStream
API](https://github.com/Level/levelup#createReadStream).

### `mapeo.observationList(opts, cb)`

Returns an array of observations to the given `callback`. Any errors are
propagated as the first argument to the callback. Same options accepted as
`mapeo.observationStream`.

### `mapeo.exportData(filename, opts, cb)`

Exports data from the osm database to the given filename. 

Options:

  * `format`: "geojson" or a "shapefile". Shapefiles export into zip format.
  * `presets`: an object that represents the contents of a `presets.json` file

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

### sync.setName(name)

Set the name of this peer / device, which will appear to others when they call
`sync.peers()`.

### sync.listen(cb)

Broadcast and listen on the local network for peers. `cb` is called once the service is up and broadcasting.

### sync.join()

Join the swarm and begin making introductory connections with other peers. 
### sync.leave()

Leave the swarm and no longer be discoverable by other peers. Any currently
open connections are kept until the swarm is destroyed (using `close` or
`destroy`).

### sync.close(cb)

Unannounces the sync service & cleans up the underlying UDP socket. `cb` is called once this is complete.

### sync.peers()

Fetch a list of the current sync peers that have been found thus far.

A peer can have the following properties:

  * `name`: a human-readable identifier for the peer (e.g., hostname)
  * `connection`: The open connection to this peer. Can be closed manually to
    stop any data transfer. 
  * `host`: the ip
  * `port`: the port
  * `type`: 'wifi' or 'file'
  * `deviceType`: either `mobile` or `desktop`, if `type == 'wifi'`
  
### sync.on('peer', peer)

Emitted when a new wifi peer connection is discovered.

### var ev = sync.replicate(target)

`peer` is an object with properties `host`, `port`, and `name` **or** an object
with the `filename` property, for local file replication. Calls
`replicateFromFile` or `replicateNetwork` below.

`filename` is a string specifying where the find the file to sync with. If it
doesn't exist, it will be created, and use the format specified in the
constructor's `opts.writeFormat`.

Both `replicate` and `replicateNetwork` return an EventEmitter `ev`. It can emit

- `"error" (err)`: gives an Error object signalling an error in syncing.
- `"progress" (progress)`: gives information about how many objects have been synced and how many to be synced in total, e.g. `{ db: { sofar: 5, total: 10 }, media: { sofar: 18, total: 100 } }`
- `"end"`: successful completion of OSM and media sync.

### var ev = sync.replicateNetwork(peer)

`peer` should be an already-discoverable peer object, emitted from the `peer`
event or returned on the `peers()` method.

If you want to replicate with a peer that is not discovered yet, but you have
the host and port, we haven't made this easy at the moment. The code is written
internally but not exposed via a public API. PRs welcome.

## Importer API (expertimental) 

The Importer allows you to import data to the osm database from other formats.

### ``mapeo.importer``

This object reports on import progress with the `progress`,
`complete`, and `error` events.

For example,
```
var mapeo = new Mapeo(osm, media)
mapeo.importer.on('progress', console.log)
mapeo.importer.on('error', console.error)
mapeo.importer.on('complete', () => { process.exit() })
mapeo.importFeatureCollection(myGeoJsonFile)
```

### ``mapeo.importer.importFeatureCollection(geojson, [cb])```

Import data from a geojson string. This is simply a wrapper around `osm-p2p-geojson`.

### ``mapeo.importer.importFromFile(filename, [cb])```

Import data from a `.geojson` file or a `.shp` file.

## License

MIT
