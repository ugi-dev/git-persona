SHELL := /bin/bash

.PHONY: help install build watch lint clean package

help:
	@echo "Git Persona Make targets:"
	@echo "  make install  - install npm dependencies"
	@echo "  make build    - compile extension"
	@echo "  make watch    - compile in watch mode"
	@echo "  make lint     - run TypeScript checks"
	@echo "  make clean    - remove build artifacts"
	@echo "  make package  - create VSIX package"

install:
	npm install

build:
	npm run build

watch:
	npm run watch

lint:
	npm run lint

clean:
	rm -rf dist *.vsix

package: build
	npx @vscode/vsce package
