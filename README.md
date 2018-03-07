# mapfilter-db

[![Build
Status](https://travis-ci.org/digidem/mapfilter-db.svg?branch=master)](https://travis-ci.org/digidem/mapfilter-db)


Media and observations store for osm-p2p.

```
npm install mapfilter-db
```

## API

```
var MapfilterDb = require('mapfilter-db')
```

### `db = MapfilterDb(osmdir)`

* `osmdir`: the path where db will store data on the local filesystem

Create a new Mapfilter-compatible database. The database will be stored in `osmdir`.

### `db.mediaRead(name, cb)`

Reads the file from the media store.

* `name`: filename to read

### `db.mediaCreate(filename, data, opts, cb)`

Create a file on the media store

* `filename`: filename to write
* `data`: The data in the file

### `stream = db.createOsmReplicationStream()`

Create a replication stream for the OSM observation data.

### `stream = db.createMediaReplicationStream()`

Create a replication stream for the media files.

### `db.replicateWithDirectory(dir, opts, cb)`

Replicate all data (observation and media) to a particular directory in an archive
that can be used to sync across USB sticks, for example.

### `db.observationCreate(feature, cb)`

Create a new observation given the feature. Will fail if an object with the
same id already exists. In that case, use `observationUpdate` more explicitly.

### `db.observationUpdate(feature, cb)`

Update an observation given the feature.

### `db.observationList(cb)`

List all observations.

### `db.close(cb)`

Close the database.

## License

MIT
