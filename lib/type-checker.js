/* */
import ts from 'typescript';
import Logger from './logger';
import {formatErrors} from './format-errors';
import {isTypescript, isTypescriptDeclaration, isAmbient} from "./utils";
import {__HTML_MODULE__} from "./compiler-host";

let logger = new Logger({ debug: false });

class Deferred {
	constructor() {
		this.promise = new Promise((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;
		});
	}
}

export class TypeChecker {
	constructor(host, resolve, fetch) {
		this._host = host;
		this._resolve = resolve;
		this._fetch = fetch;

		this._options = ts.clone(this._host.options);
		this._options.inlineSourceMap = false;
		this._options.sourceMap = false;
		this._options.declaration = false;
		this._options.isolatedModules = false;
		this._options.noLibCheck = true;

		// map of all typescript files -> file-entry
		this._files = {};
	}

	/*
		public entry point
		returns a promise to an array of typescript errors for this file
	*/
	check(sourceName, source) {
		var file = this.registerFile(sourceName);
		this.registerSource(sourceName, source);
		return file.errors;
	}

	registerFile(sourceName) {
		if (!this._files[sourceName]) {
			let file = {
				sourceName: sourceName,
				source: new Deferred()
			};

			/* flag the default lib for special handling */
			if (sourceName == this.defaultLibFileName)
				file.isDefaultLib = true;

			/* we need to fetch declaration files ourselves */
			if (isTypescriptDeclaration(sourceName)) {
				this._fetch(sourceName)
					.then((source) => {
						this._host.addFile(sourceName, source);
						this.registerSource(sourceName, source);
					});
			}

			/* loaded is a promise resolved when the source has been added to the
				host and all the dependencies used by this file have been resolved */
			file.loaded = file.source.promise
				.then((source) => this.resolveDependencies(sourceName, source))
				.then((depsMap) => {
					this._host.addResolutionMap(sourceName, depsMap);

					file.deps = Object.keys(depsMap)
						.map((key) => depsMap[key])
						.filter((res) => isTypescript(res)) // ignore e.g. css files
						.map((res) => this.registerFile(res));

					/* add the default lib as a dependency */
					return this.resolveDefaultLibFileName();
				})
				.then((defFile) => {
					file.deps.push(defFile);
				});

			/* errors is a promise to the compilation results */
			file.errors = file.loaded
				.then(() => this.canEmit(file))
				.then(() => this.getAllDiagnostics(file));

			this._files[sourceName] = file;
		}

		return this._files[sourceName];
	}

	registerSource(sourceName, source) {
		if (!this._files[sourceName])
			throw new Error(`${sourceName} has not been registered`);

		this._files[sourceName].source.resolve(source);
	}

	/*
		process the source to get its dependencies and resolve and register them
		returns a promise to the list of registered dependency files
	*/
	resolveDependencies(sourceName, source) {
		let info = ts.preProcessFile(source, true);

		/* build the list of files we need to resolve */
		/* references first */
		let references = info.referencedFiles
			.map((ref) => {
				if ((isAmbient(ref.fileName) && !this._options.resolveAmbientRefs) || (ref.fileName.indexOf("/") == -1))
					return "./" + ref.fileName;
				else
					return ref.fileName;
			});

		/* now imports */
		let imports = info.importedFiles
			.map((imp) => imp.fileName);

		let refs = [].concat(references).concat(imports);

		/* convert to list of promises to resolved addresses */
		let deps = refs.map((ref) => this._resolve(ref, sourceName));

		/* and convert to promise to a map of local reference to resolved dependency */
		return Promise.all(deps)
			.then((resolved) => {
				return refs.reduce((result, ref, idx) => {
					result[ref] = resolved[idx];
					return result;
				}, {});
			});
	}

	resolveDefaultLibFileName() {
		if (!this.defaultLibResolved) {
			this.defaultLibResolved = this._resolve(this._host.getDefaultLibFileName())
				.then((resolved) => {
					this.defaultLibFileName = resolved;
					return this.registerFile(resolved);
				});
		}
		return this.defaultLibResolved;
	}

	/*
		returns promise resolved when file can be emitted
	*/
	canEmit(file, seen) {
		/* avoid circular references */
		seen = seen || [];

		if (seen.indexOf(file) < 0) {
			seen.push(file);

			return file.loaded.then(() => Promise.all(file.deps.map((dep) => this.canEmit(dep, seen))));
		}
	}

	/*
		Returns a flattened list of the dependency tree for this file.
	*/
	accumulateDeps(file, result) {
		result = result || [];

		if (result.indexOf(file) < 0) {
			result.push(file);
			file.deps.forEach((dep) => this.accumulateDeps(dep, result));
		}

		return result;
	}

	/*
		Returns the diagnostics for this file and any files which it uses.
		Each file is only checked once.
	*/
	getAllDiagnostics(file) {
		let deps = this.accumulateDeps(file);

		// hack to support html imports
		deps.push({sourceName: __HTML_MODULE__, checked: true});

		let program = ts.createProgram(deps.map((dep) => dep.sourceName), this._options, this._host);

		return deps.reduce((diags, dep) => {
			// don't check the default lib for better performance
			if (!dep.isDefaultLib && !dep.checked) {
				let sourceFile = this._host.getSourceFile(dep.sourceName);

				diags = diags
					.concat(program.getSyntacticDiagnostics(sourceFile))
					.concat(program.getSemanticDiagnostics(sourceFile));

				dep.checked = true;
			}
			return diags;
		}, program.getGlobalDiagnostics());
	}
}
