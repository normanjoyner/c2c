var fs = require("fs");
var _ = require("lodash");
var async = require("async");
var yaml = require("yamljs");

function C2C(options){
    this.options = _.defaults(options, {
        cpus: 0.1,
        memory: 256,
        respawn: true,
        engine: "docker",
        network_mode: "bridge"
    });

    try{
        this.raw_compose = yaml.load(this.options.compose_path);
    }
    catch(e){
        throw e;
    }

    try{
        this.raw_containership = yaml.load(this.options.containership_path);
    }
    catch(e){
        this.raw_containership = {};
    }
}

C2C.prototype.convert = function(fn){
    var self = this;

    parse_configuration({
        options: this.options,
        raw_compose: this.raw_compose,
        raw_containership: this.raw_containership
    }, fn);
}

var parse_configuration = function(config, fn){
    var configuration = _.merge(config.raw_compose, config.raw_containership);

    var applications = {};
    _.each(configuration, function(application, app_name){
        var app_name = application.container_name ? application.container_name : app_name;
        applications[app_name] = {};
        applications[app_name].id = app_name;
        applications[app_name].image = application.image;

        if(_.has(application, "environment") && _.isPlainObject(application.environment))
            applications[app_name].env_vars = application.environment;
        else if(_.has(application, "environment") && _.isArray(application.environment)){
            applications[app_name].env_vars = _.zipObject(_.map(application.environment, function(env_var){
                return env_var.split("=");
            }));
        }
        else
            applications[app_name].env_vars = {}
;
        applications[app_name].tags = application.tags || {};
        applications[app_name].command = application.command ? application.command : "";
        applications[app_name].cpus = application.cpu_shares ? parseFloat((application.cpu_shares / 1000).toFixed(2)) : config.cpus;
        applications[app_name].memory = application.memory ? parseFloat((application.mem_limit / (1024 * 1024)).toFixed(2)) : config.memory;
        applications[app_name].respawn = application.restart && application.restart == "no" ? false : config.respawn;
        applications[app_name].network_mode = application.net ?  application.net : config.network_mode;

        if(application.ports && !_.isEmpty(application.ports)){
            if(application.ports.length > 1)
                applications[app_name].network_mode = "host";
            else{
                if(application.ports[0].indexOf(":"))
                    var port = _.last(application.ports[0].split(":"));
                else
                    var port = application.ports[0];

                applications[app_name].container_port = port;
            }
        }

        applications[app_name].volumes = _.map(application.volumes, function(volume){
            var parts = volume.split(":");
            if(parts.length == 1){
                return {
                    container: parts[0]
                }
            }
            else{
               return {
                    host: parts[0],
                    container: parts[1]
                }
            }
        });

        _.each(application.links, function(link){
            var link_alias = link;
            if(link.indexOf(":")){
                var link_parts = link.split(":");
                link_alias = _.last(link_parts);
                link = _.first(link_parts);
            }

            var link_application = configuration[link];

            if(_.isUndefined(link_application))
                return;

            _.each(link_application.ports, function(port){
                if(port.indexOf(":"))
                    port = _.last(port.split(":"));

                var addr_var_name = [link_alias, "PORT", port, "TCP_ADDR"].join("_");
                var addr_var_value = ["$CS", "ADDRESS", link.toUpperCase()].join("_");
                var port_var_name = [link_alias, "PORT", port, "TCP_PORT"].join("_");
                var port_var_value = ["$CS", "DISCOVERY_PORT", link.toUpperCase()].join("_");
                applications[app_name].env_vars[addr_var_name] = addr_var_value;

                if(link_application.ports.length > 1)
                    applications[app_name].env_vars[port_var_name] = port;
                else
                    applications[app_name].env_vars[port_var_name] = port_var_value;
            });
        }, this);

    }, this);

    return fn(null, applications);
}

module.exports = C2C;
