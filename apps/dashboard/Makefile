.PHONY: install dev build clean

node_modules: package.json ../../pnpm-lock.yaml
	pnpm install --filter @toph-base/dashboard
	@touch node_modules

install: node_modules

dev: node_modules
	pnpm dev

build: node_modules
	pnpm build

clean:
	rm -rf dist
