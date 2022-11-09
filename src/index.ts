import {
  Writer,
  DataFactory,
  Quad,
  BaseQuad,
  Variable,
  Literal,
  Store,
} from "n3";
import path from "path";
const nn = DataFactory.namedNode;
const quad = DataFactory.quad;

import {
  createDecoratorDefinition,
  DecoratorContext,
  Model,
  Namespace,
  Program,
  navigateProgram,
  Type,
  ModelProperty,
  getIntrinsicModelName,
  getDoc,
  isArrayModelType,
  createCadlLibrary,
  getMaxLength,
  getPattern,
  getMinLength,
  getKnownValues,
  getMinValue,
  getMaxValue,
  getSummary,
  getDeprecated,
  getFormat,
  isSecret,
  createDiagnosticCollector,
} from "@cadl-lang/compiler";
import { NamedNode } from "rdf-js";

const lib = createCadlLibrary({
  name: "cadl-rdf",
  diagnostics: {}, // no diagnostics yet
  emitter: {}, // no emitter options
});

export function $onEmit(program: Program) {
  const emitter = createRdfEmitter(program);
  emitter.emit();
}

function createRdfEmitter(program: Program) {
  const prefixes: Record<string, string> = {
    rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    rdfs: "http://www.w3.org/2000/01/rdf-schema#",
    xsd: "http://www.w3.org/2001/XMLSchema#",
    skos: "http://www.w3.org/2004/02/skos/core#",
    owl: "http://www.w3.org/2002/07/owl#http",
    sh: "http://www.w3.org/ns/shacl#",
  };

  const writer = new Writer({ prefixes });
  const classQuads: Quad[] = [];
  const propQuads: Quad[] = [];
  const constraintQuadsClass: Quad[] = [];
  const constraintQuadsProps: Quad[] = [];

  return {
    emit,
  };

  function emit() {
    navigateProgram(program, {
      model(m) {
        if (m.namespace?.name === "Cadl") {
          return;
        }

        // Checks type of model
        const intrinsicName = getIntrinsicModelName(program, m);

        if (!intrinsicName) {
          // Class
          const nameNode = nn(nameForModel(m));
          classQuads.push(
            quad(
              nameNode,
              nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
              nn("owl:Class")
            )
          );
          classQuads.push(
            quad(nameNode, nn("rdfs:label"), DataFactory.literal(m.name))
          );

          if (m.baseModel) {
            classQuads.push(
              quad(
                nameNode,
                nn("rdfs:subclassOf"),
                nn(nameForModel(m.baseModel))
              )
            );
          }

          writeDecoratorsGeneral(program, m, nameNode, classQuads);

          // Class shape
          const nameNodeShacl = nn(nameForModelSHACL(m, "_NodeShape"));
          constraintQuadsClass.push(
            quad(
              nameNodeShacl,
              nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
              nn("sh:NodeShape")
            )
          );

          constraintQuadsClass.push(
            quad(
              nameNodeShacl,
              nn("rdfs:label"),
              DataFactory.literal("Shape for " + m.name)
            )
          );

          constraintQuadsClass.push(
            quad(nameNodeShacl, nn("sh:targetClass"), nn(nameForModel(m)))
          );

          writeDecoratorsConstraints(
            program,
            m,
            nameNodeShacl,
            constraintQuadsClass
          );

          // Properties
          for (const prop of m.properties.values()) {
            const propNameNode = nn(nameForProperty(prop));

            if (prop.type.kind === "Model") {
              // TODO: It is intersection
              if (
                prop.type.properties.size != 0 &&
                checkIfIntersection(prop.type.properties) === true
              ) {
                console.log(prop.type.properties);
                console.log("___________________");
                /*
                console.log(propNameNode);
                for (var k of prop.type.properties) {
                  console.log(k[1].name);
                }*/
              }

              // Not intersection
              else {
                // Check if data property was already defined (duplication happens with composite models)

                if (!checkIfDataProperty(prop.type)) {
                  var duplicate = false;
                  if (
                    checkIfQuadsContain(
                      propQuads,
                      quad(
                        propNameNode,
                        nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
                        nn("owl:ObjectProperty")
                      )
                    ) === true
                  ) {
                    duplicate = true;
                  }

                  if (duplicate === false) {
                    propQuads.push(
                      quad(
                        propNameNode,
                        nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
                        nn("owl:ObjectProperty")
                      )
                    );
                  }
                } else {
                  var duplicate = false;
                  if (
                    checkIfQuadsContain(
                      propQuads,
                      quad(
                        propNameNode,
                        nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
                        nn("owl:DatatypeProperty")
                      )
                    ) === true
                  ) {
                    duplicate = true;
                  }
                  if (duplicate === false) {
                    propQuads.push(
                      quad(
                        propNameNode,
                        nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
                        nn("owl:DatatypeProperty")
                      )
                    );
                  }
                }

                if (duplicate === false) {
                  propQuads.push(
                    quad(
                      propNameNode,
                      nn("rdfs:label"),
                      DataFactory.literal(prop.name)
                    )
                  );
                  propQuads.push(
                    quad(
                      propNameNode,
                      nn("rdfs:range"),
                      nn(nameForModel(prop.type))
                    )
                  );

                  constraintQuadsClass.push(
                    quad(
                      nameNodeShacl,
                      nn("sh:property"),
                      writer.blank([
                        {
                          predicate: nn("sh:path"),
                          object: propNameNode,
                        },
                        {
                          predicate: nn("sh:datatype"),
                          object: nn(nameForModel(prop.type)),
                        },
                      ])
                    )
                  );
                }
              }
            } else if (prop.type.kind === "Union") {
              propQuads.push(
                quad(
                  propNameNode,
                  nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
                  nn("owl:DatatypeProperty")
                )
              );
              propQuads.push(
                quad(
                  propNameNode,
                  nn("rdfs:label"),
                  DataFactory.literal(prop.name)
                )
              );

              const arr = [];

              for (const variant of prop.type.variants.values()) {
                if (variant.type.kind === "Model") {
                  arr.push(
                    writer.blank([
                      {
                        predicate: nn("sh:path"),
                        object: propNameNode,
                      },
                      {
                        predicate: nn("sh:hasValue"),
                        object: DataFactory.literal(nameForModel(variant.type)),
                      },
                    ])
                  );
                }
                if (
                  variant.type.kind === "String" ||
                  variant.type.kind === "Number"
                ) {
                  arr.push(
                    writer.blank([
                      {
                        predicate: nn("sh:path"),
                        object: propNameNode,
                      },
                      {
                        predicate: nn("sh:hasValue"),
                        object: DataFactory.literal(variant.type.value),
                      },
                    ])
                  );
                }
              }

              constraintQuadsClass.push(
                quad(
                  nameNodeShacl,
                  nn("sh:or"),
                  writer.list(arr) as any // error in n3 typing, this is supported
                )
              );
            }

            writeDecoratorsGeneral(program, prop, propNameNode, propQuads);

            // We need SHACL shape for dataproperty if decorators enforce constraints
            if (checkDecoratorsIfGeneral(prop) == false) {
              const propNameNodeShacl = nn(
                nameForPropertySHACL(prop, "_PropertyShape")
              );

              constraintQuadsProps.push(
                quad(
                  propNameNodeShacl,
                  nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
                  nn("sh:PropertyShape")
                )
              );
              constraintQuadsProps.push(
                quad(
                  propNameNodeShacl,
                  nn("rdfs:label"),
                  DataFactory.literal("Shape for " + prop.name)
                )
              );
              constraintQuadsProps.push(
                quad(
                  propNameNodeShacl,
                  nn("sh:targetClass"),
                  nn(nameForProperty(prop))
                )
              );

              writeDecoratorsConstraints(
                program,
                prop,
                propNameNodeShacl,
                constraintQuadsProps
              );
            }
          }
        } else {
          // intrinsic
          const nameNode = nameForModel(m);
          propQuads.push(
            quad(
              nn(nameNode),
              nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
              nn("owl:DatatypeProperty")
            )
          );
          propQuads.push(
            quad(nn(nameNode), nn("rdfs:label"), DataFactory.literal(nameNode))
          );
          propQuads.push(
            quad(
              nn(nameNode),
              nn("rdfs:range"),
              nn(intrinsicToRdf(intrinsicName))
            )
          );

          writeDecoratorsGeneral(program, m, nn(nameNode), propQuads);

          const nameNodeShacl = nn(nameForModelSHACL(m, "_PropertyShape"));
          constraintQuadsProps.push(
            quad(
              nameNodeShacl,
              nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
              nn("sh:PropertyShape")
            )
          );
          constraintQuadsProps.push(
            quad(
              nameNodeShacl,
              nn("rdfs:label"),
              DataFactory.literal("Shape for " + m.name)
            )
          );
          constraintQuadsProps.push(
            quad(nameNodeShacl, nn("sh:path"), nn(nameForModel(m)))
          );
          constraintQuadsProps.push(
            quad(
              nameNodeShacl,
              nn("sh:datatype"),
              nn(intrinsicToRdf(intrinsicName))
            )
          );

          writeDecoratorsConstraints(
            program,
            m,
            nameNodeShacl,
            constraintQuadsProps
          );
        }
      },
    });

    writer.addQuad(nn("entityMarker"), nn("marker"), nn("marker"));
    writer.addQuads(classQuads);
    writer.addQuad(nn("propertyMarker"), nn("marker"), nn("marker"));
    writer.addQuads(propQuads);
    writer.addQuad(nn("shapeClassMarker"), nn("marker"), nn("marker"));
    writer.addQuads(constraintQuadsClass);
    writer.addQuad(nn("shapePropMarker"), nn("marker"), nn("marker"));
    writer.addQuads(constraintQuadsProps);

    writer.end((err, result) => {
      result = result
        .replace(/^<entityMarker.*$/m, "\n# Entities")
        .replace(/^<propertyMarker.*$/m, "\n# Properties")
        .replace(/^<shapeClassMarker.*$/m, "\n# Shapes for Entities")
        .replace(/^<shapePropMarker.*$/m, "\n# Shapes for Properties");

      program.host.writeFile(
        path.join(program.compilerOptions.outputPath!, "models.ttl"),
        result
      );
    });
  }

  function checkIfQuadsContain(quads: Quad[], quad: Quad) {
    for (var q of quads) {
      if (q.equals(quad)) {
        return true;
      }
    }
    return false;
  }

  function checkIfIntersection(properties: Map<string, ModelProperty>) {
    // Checks if this is intersection based on whether it contains only intrinsic types like string (then intersection) or it contains Models - which is just composition of models (then not intersection)

    let types = new Set<string>();
    for (var k of properties) {
      types.add(k[1].type.kind);
    }

    if (types.has("Model")) {
      return false;
    } else {
      return true;
    }
  }

  function checkDecoratorsIfGeneral(prop: ModelProperty) {
    let setDecorators = new Set();
    for (let dec of prop.decorators) {
      {
        setDecorators.add(dec.decorator.name);
      }
    }

    setDecorators.delete("$summary");
    setDecorators.delete("$doc");
    setDecorators.delete("$deprecated");

    if (setDecorators.size == 0) {
      return true;
    } else {
      return false;
    }
  }

  function writeDecoratorsGeneral(
    program: Program,
    m: Model | ModelProperty,
    object: NamedNode,
    arrayQuads: Quad[]
  ) {
    const doc = getDoc(program, m);
    if (doc) {
      arrayQuads.push(
        quad(object, nn("rdfs:comment"), DataFactory.literal(doc))
      );
    }

    const summary = getSummary(program, m);
    if (summary) {
      arrayQuads.push(
        quad(object, nn("sh:summary"), DataFactory.literal(summary))
      );
    }

    const format = getFormat(program, m);
    if (format) {
      arrayQuads.push(
        quad(object, nn("skos:example"), DataFactory.literal(format))
      );
    }

    const deprecated = getDeprecated(program, m);
    if (deprecated) {
      arrayQuads.push(
        quad(object, nn("skos:historyNote"), DataFactory.literal(deprecated))
      );
    }
  }

  function writeDecoratorsConstraints(
    program: Program,
    m: Model | ModelProperty,
    object: NamedNode,
    arrayQuads: Quad[]
  ) {
    const maxLength = getMaxLength(program, m);
    if (maxLength) {
      arrayQuads.push(
        quad(object, nn("sh:maxLength"), DataFactory.literal(maxLength))
      );
    }

    const minLength = getMinLength(program, m);
    if (minLength) {
      arrayQuads.push(
        quad(object, nn("sh:minLength"), DataFactory.literal(minLength))
      );
    }

    const minValue = getMinValue(program, m);
    if (minValue) {
      arrayQuads.push(
        quad(object, nn("sh:minInclusive"), DataFactory.literal(minValue))
      );
    }

    const maxValue = getMaxValue(program, m);
    if (maxValue) {
      arrayQuads.push(
        quad(object, nn("sh:maxInclusive"), DataFactory.literal(maxValue))
      );
    }

    const pattern = getPattern(program, m);
    if (pattern) {
      arrayQuads.push(
        quad(object, nn("sh:pattern"), DataFactory.literal(pattern))
      );
    }

    const secret = isSecret(program, m);
    if (secret) {
      arrayQuads.push(
        quad(object, nn("sh:secret"), DataFactory.literal("True"))
      );
    }
  }

  function checkIfDataProperty(model: Model) {
    return getIntrinsicModelName(program, model) !== undefined;
  }

  function nameForModel(model: Model) {
    const intrinsic = getIntrinsicModelName(program, model);

    if (!intrinsic || intrinsic !== model.name) {
      let ns = getNsForModel(model);
      if (model.name === "Array") {
        if (model.templateArguments != undefined) {
          return ns.prefix + ":" + (<any>model.templateArguments[0]).name;
        }
      } else {
        return ns.prefix + ":" + model.name;
      }
    }

    return intrinsicToRdf(intrinsic);
  }

  function intrinsicToRdf(intrinsicName: string) {
    switch (intrinsicName) {
      case "boolean":
        return "xsd:boolean";
      case "bytes":
        return "xsd:hexBinary"; // could be base64, check format?
      case "duration":
        return "xsd:dayTimeDuration";
      case "float":
        return "xsd:double"; // seems best for either float32 or float64?
      case "float32":
        return "xsd:float";
      case "float64":
        return "xsd:double";
      case "integer":
        return "xsd:integer";
      case "uint8":
        return "xsd:unsignedByte";
      case "uint16":
        return "xsd:unsignedShort";
      case "uint32":
        return "xsd:unsignedIntS";
      case "uint64":
        return "xsd:unsignedLong";
      case "int8":
        return "xsd:byte";
      case "int16":
        return "xsd:short";
      case "int32":
        return "xsd:int";
      case "int64":
        return "xsd:long";
      case "safeint":
        return "xsd:long";
      case "string":
        return "xsd:string";
      case "numeric":
        return "xsd:decimal";
      case "plainDate":
        return "xsd:date";
      case "plainTime":
        return "xsd:time";
      case "zonedDateTime":
        return "xsd:dateTime";
      default:
        throw new Error(
          "xsd datatype not defined for instrinsic " + intrinsicName
        );
    }
  }

  function nameForModelSHACL(model: Model, shapeType: string) {
    return nameForModel(model) + shapeType;
  }

  function nameForPropertySHACL(prop: ModelProperty, shapeType: string) {
    let ns = getNsForModel(prop.model!);
    return ns.prefix + ":" + prop.name + shapeType;
  }

  function nameForProperty(prop: ModelProperty) {
    let ns = getNsForModel(prop.model!);
    return ns.prefix + ":" + prop.name;
  }

  function getNsForModel(type: Model) {
    let current: Model | Namespace | undefined = type;
    let nsData: RdfnsData | undefined;

    while (current && !nsData) {
      nsData = getRdfnsState(program).get(current);
      current = current.namespace;
    }

    if (!nsData) {
      nsData = { prefix: "ex", namespace: "http://example.org/" };
    }

    if (!prefixes.hasOwnProperty(nsData.prefix)) {
      writer.addPrefix(
        nsData.prefix,
        nsData.namespace + getNameSpace(type) + "/"
      );
      prefixes[nsData.prefix] = nsData.namespace;
    }

    return nsData;
  }

  function getNameSpace(model: Model) {
    let nm = model.namespace;
    let nmString = "";
    while (nm) {
      nmString = nm.name + "." + nmString;
      nm = nm.namespace;
    }

    return nmString.substring(1, nmString.length - 1);
  }
}

interface RdfnsData {
  prefix: string;
  namespace: string;
}

const rdfnsSymbol = lib.createStateSymbol("rdfns");
const rdfnsDef = createDecoratorDefinition({
  name: "@rdfns",
  target: ["Namespace", "Model"],
  args: [{ kind: "String" }, { kind: "String" }],
} as const);

function getRdfnsState(program: Program): Map<Type, RdfnsData> {
  return program.stateMap(rdfnsSymbol);
}

export function $rdfns(
  context: DecoratorContext,
  target: Namespace | Model,
  prefix: string,
  namespace: string
) {
  if (!rdfnsDef.validate(context, target, [prefix, namespace])) {
    return;
  }

  getRdfnsState(context.program).set(target, {
    prefix,
    namespace,
  });
}

export const namespace = "CadlRdf";
