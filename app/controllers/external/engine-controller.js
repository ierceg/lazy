'use strict';

/* global logger */

const _ = require('lodash');
const selectn = require('selectn');
const proxy = require('http-proxy-middleware');
const PACKAGE_VERSION = require('../../../package.json').version;
const EnginePipeline = require('@lazyass/engine-pipeline');

let enginePipeline;
let engineManager;

const addEndpoints = (app, options) => {
    app.get('/version', (req, res) => {
        res.send({
            service: PACKAGE_VERSION,
            api: 'v20161217'
        });
    });

    app.get('/engines', (req, res) => {
        res.send(_.reduce(engineManager.engines, (engines, engine) => {
            // lazy ignore-once no-param-reassign
            engines[engine.id] = {
                url: engine.url,
                meta: engine.meta
            };
            return engines;
        }, {}));
    });

    app.post('/file', (req, res) => {
        const language = selectn('body.language', req);
        const hostPath = selectn('body.hostPath', req);
        if (_.isEmpty(language) || _.isEmpty(hostPath)) {
            return res.status(400).send();
        }

        const content = selectn('body.content', req);
        const context = selectn('body.context', req);

        try {
            return enginePipeline.analyzeFile(hostPath, language, content, context)
                .then(engineOutput => res.send(engineOutput))
                .catch((err) => {
                    res.status(500).send({
                        error: err && err.message
                    });
                });
        } catch (err) {
            logger.error('Exception during file analysis', { err: err && err.toString() });
            return res.status(500).send({
                error: err && err.message
            });
        }
    });

    //  Create proxies to pass all requests that get to /engine/{engine.id}/* paths.
    _.forEach(engineManager.engine, (engine) => {
        const enginePath = `/engine/${engine.id}`;

        //  Proxy all calls from /engine/<engine.id> to the engine.
        //  Allow websockets upgrade.
        const proxyOptions = {
            target: engine.url,
            ws: true,
            pathRewrite: {}
        };
        proxyOptions.pathRewrite[`^${enginePath}`] = '';

        app.use(enginePath, proxy(enginePath, proxyOptions));
    });

    //  Proxy the rest of calls to / to UI engine if one has been configured.
    const uiEngine = _.get(options, 'engineManager.uiEngine');
    if (uiEngine) {
        //  Proxy all calls from / to the engine and allow websockets upgrade.
        app.use('/', proxy({
            target: uiEngine.url,
            ws: true
        }));
    }
};

const initialize = (app, options) => {
    engineManager = options.engineManager;
    enginePipeline = new EnginePipeline(
        engineManager.engines, _.get(options, 'config.engine_pipeline'));
    enginePipeline.on('metrics', (metrics) => {
        // Log all metrics through logger.metric mechanism.
        _.forEach(metrics, metric => logger.metric(metric));
    });
    addEndpoints(app, options);
    return Promise.resolve();
};

module.exports = {
    initialize
};
