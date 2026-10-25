const path = require("path");
const { EsbuildPlugin } = require("esbuild-loader");
const { FileUploader } = require("@cocreate/webpack");

module.exports = async (env, argv) => {
	const isProduction = argv && argv.mode === "production";
	const config = {
		entry: {
			"CoCreate-cursors": "./src/index.js"
		},
		output: {
			path: path.resolve(__dirname, "dist"),
			filename: isProduction ? "[name].min.js" : "[name].js",
			libraryExport: "default",
			library: ["CoCreate", "cursors"],
			clean: true
		},
		plugins: [new FileUploader(env, argv)],
		mode: isProduction ? "production" : "development",
		devtool: isProduction ? "source-map" : "eval-source-map",
		module: {
			rules: [
				{
					test: /.js$/,
					exclude: /node_modules/,
					use: {
						loader: "esbuild-loader",
						options: {
							loader: "js",
							target: "es2017"
						}
					}
				}
			]
		},
		optimization: {
			minimize: isProduction,
			minimizer: [
				new EsbuildPlugin({
					target: "es2017"
				})
			],
			splitChunks: {
				cacheGroups: {
					defaultVendors: false
				}
			}
		},
		performance: {
			hints: isProduction ? "warning" : false
		}
	};
	return config;
};
