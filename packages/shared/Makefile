.PHONY: install build clean

node_modules: package.json ../../pnpm-lock.yaml
	pnpm install --filter @toph-base/shared
	@touch node_modules

install: node_modules

build: node_modules
	pnpm build

clean:
	rm -rf dist
