.PHONY: install dev build test clean \
	dashboard/install dashboard/dev dashboard/build dashboard/clean \
	api/install api/dev api/build api/test api/clean api/migrate \
	shared/install shared/build shared/clean

# ── Orchestration ────────────────────────────────────────────

install: shared/install api/install dashboard/install

dev:
	$(MAKE) -j3 shared/build api/dev dashboard/dev

build: shared/build api/build dashboard/build

test: api/test

clean: api/clean dashboard/clean shared/clean

# ── Dashboard (apps/dashboard) ───────────────────────────────

dashboard/install:
	$(MAKE) -C apps/dashboard install

dashboard/dev:
	$(MAKE) -C apps/dashboard dev

dashboard/build:
	$(MAKE) -C apps/dashboard build

dashboard/clean:
	$(MAKE) -C apps/dashboard clean

# ── API Gateway (services/api-gateway) ───────────────────────

api/install:
	$(MAKE) -C services/api-gateway install

api/dev:
	$(MAKE) -C services/api-gateway dev

api/build:
	$(MAKE) -C services/api-gateway build

api/test:
	$(MAKE) -C services/api-gateway test

api/clean:
	$(MAKE) -C services/api-gateway clean

api/migrate:
	$(MAKE) -C services/api-gateway migrate

# ── Shared (packages/shared) ────────────────────────────────

shared/install:
	$(MAKE) -C packages/shared install

shared/build:
	$(MAKE) -C packages/shared build

shared/clean:
	$(MAKE) -C packages/shared clean
