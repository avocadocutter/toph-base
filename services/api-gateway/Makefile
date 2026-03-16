.PHONY: install dev build test clean migrate

node_modules: package.json ../../pnpm-lock.yaml
	pnpm install --filter @toph-base/api-gateway
	@touch node_modules

install: node_modules

dev: node_modules
	pnpm dev

build: node_modules
	pnpm build

test: node_modules
	pnpm test

clean:
	rm -rf dist

migrate: node_modules
	pnpm migrate
