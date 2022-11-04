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
} from "@cadl-lang/compiler";

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
  const constraintQuads: Quad[] = [];

  return {
    emit,
  };

  function emit() {
    navigateProgram(program, {
      model(m) {
        if (m.namespace?.name === "Cadl") {
          return;
        }

        // CLASS PART
        // Checks if Model is actual class (model Truck) or Model is a data property (model CUSIP is string)
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

          const doc = getDoc(program, m);
          if (doc) {
            classQuads.push(
              quad(nameNode, nn("rdfs:comment"), DataFactory.literal(doc))
            );
          }

          //PROP PART & SHACL part

          const nameNodeShacl = nn(nameForModelSHACL(m));
          constraintQuads.push(
            quad(
              nameNodeShacl,
              nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
              nn("sh:NodeShape")
            )
          );
          constraintQuads.push(
            quad(
              nameNodeShacl,
              nn("rdfs:label"),
              DataFactory.literal("Shape for " + m.name)
            )
          );
          constraintQuads.push(
            quad(nameNodeShacl, nn("sh:targetClass"), nn(nameForModel(m)))
          );

          for (const prop of m.properties.values()) {
            const propNameNode = nn(nameForProperty(prop));

            if (prop.type.kind === "Model") {
              // PROPERTIES
              if (!checkIfDataProperty(prop.type)) {
                propQuads.push(
                  quad(
                    propNameNode,
                    nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
                    nn("owl:ObjectProperty")
                  )
                );
              } else {
                propQuads.push(
                  quad(
                    propNameNode,
                    nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
                    nn("owl:DatatypeProperty")
                  )
                );
              }

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

              // SHACL
              constraintQuads.push(
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
            } else if (prop.type.kind === "Union") {
              // PROPERTIES
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

              //SHACL
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

              constraintQuads.push(
                quad(
                  nameNodeShacl,
                  nn("sh:or"),
                  writer.list(arr) as any // error in n3 typing, this is supported
                )
              );
            }

            const doc = getDoc(program, prop);
            if (doc) {
              propQuads.push(
                quad(propNameNode, nn("rdfs:comment"), DataFactory.literal(doc))
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
        }
      },
    });

    writer.addQuad(nn("entityMarker"), nn("marker"), nn("marker"));
    writer.addQuads(classQuads);
    writer.addQuad(nn("propertyMarker"), nn("marker"), nn("marker"));
    writer.addQuads(propQuads);
    writer.addQuad(nn("shapeMarker"), nn("marker"), nn("marker"));
    writer.addQuads(constraintQuads);

    writer.end((err, result) => {
      result = result
        .replace(/^<entityMarker.*$/m, "\n# Entities")
        .replace(/^<propertyMarker.*$/m, "\n# Properties")
        .replace(/^<shapeMarker.*$/m, "\n# Shapes");

      program.host.writeFile(
        path.join(program.compilerOptions.outputPath!, "models.ttl"),
        result
      );
    });
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

  function nameForModelSHACL(model: Model) {
    return nameForModel(model) + "_NodeShape";
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
