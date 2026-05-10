.PHONY: install dev build clean lint

node_modules: package.json $(wildcard pnpm-lock.yaml)
	pnpm install
	@touch node_modules

install: node_modules

dev: node_modules
	pnpm dev

build: node_modules
	pnpm build

clean:
	rm -rf dist

lint: node_modules
	pnpm lint
