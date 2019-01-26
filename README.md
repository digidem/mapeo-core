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

* `osm`: an `osm-p2p-db` instance
* `media`: a blob storage instance
* `opts`: options

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

### `mapeo.observationList(cb)`

Returns an array of observations to the given `callback`. Any errors are
propagated as the first argument to the callback.

### `mapeo.observationStream()`

Returns a stream of observations.

### `mapeo.observationConvert(obs, cb)`

Convert an observation to an OSM type `node`.

### `mapeo.close()

## Sync API

Mapeo core provides some key functionality for syncing between two devices over
WiFi and filesystem (i.e., over USB sneakernets).

`const sync = mapeo.sync`

### sync.listen(cb)

Broadcast and listen on the local network for peers. `cb` is called once the service is up and broadcasting.

### sync.announce(cb)

(Re-)broadcasts the sync service on the local network. Calls `sync.listen` if it wasn't called before. `cb` is called once the service is up and has broadcasted itself.

### sync.unannounce(cb)

Unpublishes the sync service from the local network. `cb` is called on completion.

### sync.targets

Fetch a list of the current sync targets that have been found thus far.

A target can have the following properties:

  * `name`: a human-readable identifier for the target (e.g., hostname)
  * `host`: the ip
  * `port`: the port
  * `type`: 'wifi' or 'file'
  * `status`: 'replication-started', 'media-connected', 'osm-connected', 'replication-error'
  * `message`: any extra information needed for this target, a message from mapeo-sync

### var ev = sync.syncToTarget(target)

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

### var r = sync.osmReplicationStream([opts])

Returns the duplex replication stream `r`. This can be piped into another [osm-p2p-db][]'s replication stream to sync the two databases together, e.g.

```js
var r = sync.osmReplicationStream()
r.pipe(myOsm.log.replicate()).pipe(r)
```

### var r sync.mediaReplicationStream([opts])

Returns the duplex replication stream `r`. This can be piped into another [abstract-blob-store][]'s replication stream (created by [blob-store-replication-stream][]) to sync the two media sets together, e.g.

```js
var blobSync = require('blob-store-replication-stream')
var r = sync.mediaReplicationStream()
r.pipe(blobSync(myMediaBlobStore).pipe(r)
```

### sync.close(cb)

Unannounces the sync service & cleans up the underlying UDP socket.


## License

MIT
