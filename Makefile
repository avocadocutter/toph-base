.PHONY: install dev build test lint clean docker/up \
	dashboard/install dashboard/dev dashboard/build dashboard/clean dashboard/lint \
	api/install api/dev api/build api/test api/clean api/lint

SECRETS ?= $(or $(TOPH_SECRETS),$(HOME)/.secrets/toph-base.env)

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

api/lint:
	$(MAKE) -C apps/api lint

dashboard/lint:
	$(MAKE) -C apps/dashboard lint

lint: api/lint dashboard/lint

docker/up:
	dotenvx run -f $(SECRETS) -- docker compose up --build

