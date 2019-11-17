# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [8.1.0](https://github.com/digidem/mapeo-core/compare/v8.0.4...v8.1.0) (2019-11-17)


### Features

* add error metadata ([#63](https://github.com/digidem/mapeo-core/issues/63)) ([025a8b0](https://github.com/digidem/mapeo-core/commit/025a8b09fe29e12ade4162296012308e51b977ad))

### [8.0.4](https://github.com/digidem/mapeo-core/compare/v8.0.3...v8.0.4) (2019-11-14)

### ⚠ BREAKING CHANGES

* Upgrade stack to use multifeed@4 (breaking change to sync protocol).

    Clients using mapeo-core@7 will not be able to sync with clients using mapeo-core@8, and unfortunately due to a bug clients at mapeo-core@7 will not throw an error, but the @8 side will.

### Features

* Add option to sync based on a `projectKey`.

    Only clients with the same `projectKey` will be able to discover each other
  and sync. Only sync files with the same `projectKey` as the client will sync.
  If no project key is specified the default is `mapeo` and will continue to
  work with older clients.

### Bug Fixes

* projectId -> projectKey for syncfile opts ([6ab4406](https://github.com/digidem/mapeo-core/commit/6ab4406e2b4812cd48e9ed746cbf6384da134ae8))
* use discovery key in syncfile ([#62](https://github.com/digidem/mapeo-core/issues/62)) ([4a9a25b](https://github.com/digidem/mapeo-core/commit/4a9a25b87fbb7616cfba64a66ac0d80c9cb7cc48))

## [7.1.0](https://github.com/digidem/mapeo-core/compare/v7.0.3...v7.1.0) (2019-09-12)

### Bug Fixes

* Fix breaking test ([f4cf237](https://github.com/digidem/mapeo-core/commit/f4cf237))


### Features

* Use project IDs to prevent sneakernet sync between different projects ([6db8df7](https://github.com/digidem/mapeo-core/commit/6db8df7))
