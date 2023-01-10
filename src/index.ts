import {
  Writer,
  DataFactory,
  Quad,
  BaseQuad,
  Variable,
  Literal,
  Store,
  BlankNode,
} from "n3";
import path from "path";

const nn = DataFactory.namedNode;
const quad = DataFactory.quad;

import { Md5 } from "ts-md5";
import { getExtensions } from "@cadl-lang/openapi";
import {
  createDecoratorDefinition,
  DecoratorContext,
  Model,
  Namespace,
  Program,
  navigateProgram,
  Type,
  ModelProperty,
  getDoc,
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
  Enum,
  EmitContext,
  Scalar,
  Union,
} from "@cadl-lang/compiler";
import { NamedNode } from "rdf-js";
import { createStateSymbol } from "./lib.js";

export function $onEmit(context: EmitContext) {
  const emitter = createRdfEmitter(context.program);
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
  const namedIndividualsProps: Quad[] = [];

  return {
    emit,
  };

  function underCadlNamespace(type: Enum | Model | Union | Scalar) {
    let current = type.namespace;
    while (current) {
      if (current.name === "Cadl") return true;
      current = current.namespace;
    }
    return false;
  }
  function emit() {
    navigateProgram(program, {
      enum(e) {
        if (underCadlNamespace(e)) {
          return;
        }
        if (program.checker.isStdType(e)) {
          return;
        }

        processEnum(e);
      },
      scalar(s) {
        if (underCadlNamespace(s)) {
          return;
        }
        const nameNode = nameForModelOrScalar(s);
        const baseScalar = baseTypeForScalar(s);

        propQuads.push(
          quad(
            nn(nameNode),
            nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
            nn("owl:Property")
          )
        );
        propQuads.push(
          quad(
            nn(nameNode),
            nn("rdfs:label"),
            DataFactory.literal(s.name.split(/(?=[A-Z])/).join(" "))
          )
        );
        propQuads.push(
          quad(
            nn(nameNode),
            nn("rdfs:range"),
            nn(intrinsicToRdf(baseScalar.name))
          )
        );

        writeDecoratorsGeneral(program, s, nn(nameNode), propQuads);

        const nameNodeShacl = nn(nameForModelSHACL(s, "_PropertyShape"));
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
            DataFactory.literal("Shape for " + s.name)
          )
        );
        constraintQuadsProps.push(
          quad(nameNodeShacl, nn("sh:path"), nn(nameForModelOrScalar(s)))
        );
        constraintQuadsProps.push(
          quad(
            nameNodeShacl,
            nn("sh:datatype"),
            nn(intrinsicToRdf(baseScalar.name))
          )
        );

        writeDecoratorsConstraints(
          program,
          s,
          nameNodeShacl,
          constraintQuadsProps
        );
      },
      model(m) {
        if (underCadlNamespace(m)) {
          return;
        }

        const nameNode = nn(nameForModelOrScalar(m));

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
              nn(nameForModelOrScalar(m.baseModel))
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
          quad(nameNodeShacl, nn("sh:targetClass"), nn(nameForModelOrScalar(m)))
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
                nn(nameForModelOrScalar(prop.type))
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
                    object: nn(nameForModelOrScalar(prop.type)),
                  },
                ])
              )
            );

            /*classQuads.push(
                quad(
                  nameNode,
                  nn("rdfs:subClassOf"),
                  writer.blank([
                    {
                      predicate: nn("rdf:type"),
                      object: nn("owl:Restriction"),
                    },
                    {
                      predicate: nn("owl:onProperty"),
                      object: propNameNode,
                    },
                    {
                      predicate: nn("owl:someValuesFrom"),
                      object: nn(nameForModel(prop.type)),
                    },
                  ])
                )
              );*/
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
                      object: DataFactory.literal(
                        nameForModelOrScalar(variant.type)
                      ),
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
          } else if (prop.type.kind === "Enum") {
            classQuads.push(
              quad(
                nameNode,
                nn("rdfs:subClassOf"),
                writer.blank([
                  {
                    predicate: nn("rdf:type"),
                    object: nn("owl:Restriction"),
                  },
                  {
                    predicate: nn("owl:onProperty"),
                    object: propNameNode,
                  },
                  {
                    predicate: nn("owl:someValuesFrom"),
                    object: nn(nameForEnum(prop.type)),
                  },
                ])
              )
            );

            constraintQuadsClass.push(
              quad(
                nameNodeShacl,
                nn("sh:property"),
                writer.blank([
                  {
                    predicate: nn("sh:path"),
                    object: writer.list([
                      propNameNode,
                      nn("skos:member"),
                    ]) as any,
                  },
                  {
                    predicate: nn("sh:class"),
                    object: nn(nameForEnumCollectionHashed(prop.type)),
                  },
                ])
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
      },
    });

    writer.addQuad(nn("entityMarker"), nn("marker"), nn("marker"));
    writer.addQuads(classQuads);
    writer.addQuad(nn("propertyMarker"), nn("marker"), nn("marker"));
    writer.addQuads(propQuads);
    writer.addQuad(nn("namedIndividualsMarker"), nn("marker"), nn("marker"));
    writer.addQuads(namedIndividualsProps);
    writer.addQuad(nn("shapeClassMarker"), nn("marker"), nn("marker"));
    writer.addQuads(constraintQuadsClass);
    writer.addQuad(nn("shapePropMarker"), nn("marker"), nn("marker"));
    writer.addQuads(constraintQuadsProps);

    writer.end((err, result) => {
      result = result
        .replace(/^<entityMarker.*$/m, "\n# Entities")
        .replace(/^<propertyMarker.*$/m, "\n# Properties")
        .replace(
          /^<namedIndividualsMarker.*$/m,
          "\n# Named Individual Definitions"
        )
        .replace(/^<shapeClassMarker.*$/m, "\n# Shapes for Entities")
        .replace(/^<shapePropMarker.*$/m, "\n# Shapes for Properties");

      program.host.writeFile(
        path.join(program.compilerOptions.outputPath!, "models.ttl"),
        result
      );
    });
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

  function processEnum(e: Enum) {
    const nameNode = nn(nameForEnum(e));
    const nameNodeCollection = nn(nameForEnumCollection(e));
    const nameNodeCollectionHashed = nn(nameForEnumCollectionHashed(e));

    classQuads.push(
      quad(
        nameNodeCollection,
        nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        nn("owl:Class")
      )
    );
    classQuads.push(
      quad(
        nameNodeCollection,
        nn("rdfs:label"),
        DataFactory.literal(e.name.split(/(?=[A-Z])/).join(" ") + " Collection")
      )
    );

    classQuads.push(
      quad(nameNodeCollection, nn("rdfs:subclassOf"), nn("skos:Collection"))
    );

    classQuads.push(
      quad(
        nameNodeCollection,
        nn("rdfs:subclassOf"),
        writer.blank([
          {
            predicate: nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
            object: nn("owl:Restriction"),
          },
          {
            predicate: nn("owl:onProperty"),
            object: nn("skos:member"),
          },
          {
            predicate: nn("owl:allValuesFrom"),
            object: nameNode,
          },
        ])
      )
    );

    classQuads.push(
      quad(
        nameNode,
        nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        nn("owl:Class")
      )
    );
    classQuads.push(
      quad(
        nameNode,
        nn("rdfs:label"),
        DataFactory.literal(e.name.split(/(?=[A-Z])/).join(" "))
      )
    );

    classQuads.push(
      quad(
        nameNodeCollectionHashed,
        nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        nameNodeCollection
      )
    );

    for (const member of e.members) {
      const memberNameNode = nn(
        nameForEnumMember(e, member[0].replace(/\s/g, ""))
      );

      //COMPOSITE
      if (member[1].sourceMember != undefined) {
        let obj = nn(nameForEnumCollectionHashed(member[1].sourceMember.enum));

        //Check if enum definiton is already there to prevent duplicate values
        if (
          !classQuads.some(
            (i) =>
              JSON.stringify(i.subject) ===
                JSON.stringify(nameNodeCollectionHashed) &&
              JSON.stringify(i.predicate) ===
                JSON.stringify(nn(getNameSpaceForWord(e, "contains"))) &&
              JSON.stringify(i.object) === JSON.stringify(obj)
          )
        ) {
          classQuads.push(
            quad(
              nameNodeCollectionHashed,
              nn(getNameSpaceForWord(e, "contains")),
              obj
            )
          );
        }
      }

      // NOT COMPOSITE
      else {
        namedIndividualsProps.push(
          quad(
            memberNameNode,
            nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
            nameNode
          )
        );

        namedIndividualsProps.push(
          quad(memberNameNode, nn("rdfs:label"), DataFactory.literal(member[0]))
        );

        if (member[1].value) {
          namedIndividualsProps.push(
            quad(
              memberNameNode,
              nn(getEnumValueType(member[1].value)),
              DataFactory.literal(member[1].value)
            )
          );
        }

        classQuads.push(
          quad(nameNodeCollectionHashed, nn("skos:member"), memberNameNode)
        );
      }
    }
  }

  function writeDecoratorsGeneral(
    program: Program,
    m: Model | ModelProperty | Scalar,
    object: NamedNode,
    arrayQuads: Quad[]
  ) {
    const doc = getDoc(program, m);
    if (doc) {
      arrayQuads.push(quad(object, nn("skos:note"), DataFactory.literal(doc)));
    }
    const summary = getSummary(program, m);
    if (summary) {
      arrayQuads.push(
        quad(object, nn("skos:definition"), DataFactory.literal(summary))
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
        quad(object, nn("owl:deprecated"), DataFactory.literal(deprecated))
      );
    }

    if (m.kind !== "Model") {
      const knownValues = getKnownValues(program, m);
      if (knownValues) {
        processEnum(knownValues);
      }
    }
  }

  function writeDecoratorsConstraints(
    program: Program,
    m: Model | ModelProperty | Scalar,
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

    if (getPii(program, m)) {
      arrayQuads.push(
        quad(object, nn("sh:ISPII"), DataFactory.literal("True"))
      );
    }
  }

  function checkIfDataProperty(type: Model | Scalar) {
    return type.kind === "Scalar";
  }

  function baseTypeForScalar(scalar: Scalar): Scalar {
    let current = scalar;
    while (current.baseScalar) {
      current = current.baseScalar;
    }

    return current;
  }

  function nameForModelOrScalar(type: Model | Scalar): string {
    if (type.kind === "Scalar" && program.checker.isStdType(type)) {
      return intrinsicToRdf(type.name);
    }

    let ns = getNsForModel(type);
    if (type.name === "Array") {
      if (type.templateArguments != undefined) {
        return ns.prefix + ":" + (<any>type.templateArguments[0]).name;
      } else {
        return ns.prefix + ":" + type.name;
      }
    } else {
      return ns.prefix + ":" + type.name;
    }
  }

  function nameForEnum(e: Enum) {
    let ns = getNsForModel(e);
    return ns.prefix + ":" + e.name;
  }

  function nameForEnumCollection(e: Enum) {
    let ns = getNsForModel(e);
    return ns.prefix + ":" + e.name + "Collection";
  }

  function nameForEnumCollectionHashed(e: Enum) {
    let ns = getNsForModel(e);
    return ns.prefix + ":" + e.name + "Collection" + "_" + hashTheObject(e);
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

  function nameForModelSHACL(type: Model | Scalar, shapeType: string) {
    return nameForModelOrScalar(type) + shapeType;
  }

  function nameForPropertySHACL(prop: ModelProperty, shapeType: string) {
    let ns = getNsForModel(prop.model!);
    return ns.prefix + ":" + prop.name + shapeType;
  }

  function nameForProperty(prop: ModelProperty) {
    let ns = getNsForModel(prop.model!);
    return ns.prefix + ":" + prop.name;
  }

  function nameForEnumMember(e: Enum, s: String) {
    let ns = getNsForModel(e);
    return ns.prefix + ":" + e.name + "_" + s;
  }

  function getNsForModel(type: Model | Enum | Scalar) {
    let current: Model | Namespace | Enum | Scalar | undefined = type;
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

  function getNameSpace(model: Model | Enum | Scalar) {
    let nm = model.namespace;
    let nmString = "";
    while (nm) {
      nmString = nm.name + "." + nmString;
      nm = nm.namespace;
    }

    return nmString.substring(1, nmString.length - 1);
  }

  // TODO: Improve but works for now
  function hashTheObject(obj: Enum) {
    let s = "";
    for (let [key, value] of obj.members) {
      s = s + key.toString;
      if (value.value) {
        s = s + value.value;
      }
    }
    return Md5.hashStr(JSON.stringify(s));
  }

  function getEnumValueType(obj: any) {
    let ns = getNsForModel(obj);

    if (typeof obj === "string") {
      return ns.prefix + ":" + "stringValue";
    } else if (typeof obj === "number") {
      if (obj % 1 != 0) {
        return ns.prefix + ":" + "decimalValue";
      } else {
        return ns.prefix + ":" + "numberValue";
      }
    } else {
      return ns.prefix + ":" + "anyValue";
    }
  }

  function getNameSpaceForWord(e: Enum, s: String) {
    let ns = getNsForModel(e);
    return ns.prefix + ":" + s;
  }
}

interface RdfnsData {
  prefix: string;
  namespace: string;
}

const rdfnsSymbol = createStateSymbol("rdfns");

function getRdfnsState(program: Program): Map<Type, RdfnsData> {
  return program.stateMap(rdfnsSymbol);
}

export function $rdfns(
  context: DecoratorContext,
  target: Namespace | Model | Enum,
  prefix: string,
  namespace: string
) {
  getRdfnsState(context.program).set(target, {
    prefix,
    namespace,
  });
}

export const namespace = "CadlRdf";

export function getPii(program: Program, target: Type) {
  const extensions = getExtensions(program, target);
  return extensions.get("x-ms-pii") ?? false;
}
