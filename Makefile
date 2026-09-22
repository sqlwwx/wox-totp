.PHONY: build dev test clean

build:
	bun build.mjs

dev:
	bun build.mjs --watch

test: build
	bun test test/

clean:
	rm -rf dist
