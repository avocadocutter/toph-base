.PHONY: install dev build test clean

node_modules: package.json $(wildcard pnpm-lock.yaml)
	pnpm install
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
