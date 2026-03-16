.PHONY: install dev build test clean \
	dashboard/install dashboard/dev dashboard/build dashboard/clean \
	api/install api/dev api/build api/test api/clean

# ── Orchestration ────────────────────────────────────────────

install: api/install dashboard/install

dev:
	$(MAKE) -j2 api/dev dashboard/dev

build: api/build dashboard/build

test: api/test

clean: api/clean dashboard/clean

# ── Dashboard (apps/dashboard) ───────────────────────────────

dashboard/install:
	$(MAKE) -C apps/dashboard install

dashboard/dev:
	$(MAKE) -C apps/dashboard dev

dashboard/build:
	$(MAKE) -C apps/dashboard build

dashboard/clean:
	$(MAKE) -C apps/dashboard clean

# ── API (apps/api) ───────────────────────────────────────────

api/install:
	$(MAKE) -C apps/api install

api/dev:
	$(MAKE) -C apps/api dev

api/build:
	$(MAKE) -C apps/api build

api/test:
	$(MAKE) -C apps/api test

api/clean:
	$(MAKE) -C apps/api clean

