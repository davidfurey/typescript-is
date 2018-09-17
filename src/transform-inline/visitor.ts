import * as ts from 'typescript';
import * as tsutils from 'tsutils';
import { VisitorContext } from './visitor-context';

function reportNode(node: ts.Node) {
    const sourceFile = node.getSourceFile();
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    return `${sourceFile.fileName}:${line + 1}:${character + 1}`;
}

function stringifyTypeNodes(nodes: ts.NodeArray<ts.TypeNode> | undefined, visitorContext: VisitorContext): string {
    return nodes === undefined ? '' : '<' + nodes.map((node) => stringifyTypeNode(node, visitorContext)).join(',') + '>';
}

function stringifyTypeNode(node: ts.TypeNode, visitorContext: VisitorContext): string {
    if (node.kind === ts.SyntaxKind.NumberKeyword) {
        return 'number';
    } else if (node.kind === ts.SyntaxKind.StringKeyword) {
        return 'string';
    } else if (node.kind === ts.SyntaxKind.BooleanKeyword) {
        return 'boolean';
    } else if (ts.isTypeReferenceNode(node)) {
        const type = visitorContext.checker.getTypeFromTypeNode(node);
        const fqn = visitorContext.checker.getFullyQualifiedName(type.symbol);
        const typeArgumentsPostfix = stringifyTypeNodes(node.typeArguments, visitorContext);
        return fqn + typeArgumentsPostfix;
    } else if (ts.isLiteralTypeNode(node)) {
        if (ts.isStringLiteral(node.literal)) {
            return JSON.stringify(node.literal.text);
        } else {
            throw new Error('Unsupported LiteralTypeNode kind: ' + node.kind);
        }
    } else {
        throw new Error('Unsupported TypeNode kind: ' + node.kind);
    }
}

function visitNumberKeyword(node: ts.TypeNode, accessor: ts.Expression, visitorContext: VisitorContext) {
    return ts.createStrictEquality(ts.createTypeOf(accessor), ts.createStringLiteral('number'));
}

function visitBooleanKeyword(node: ts.TypeNode, accessor: ts.Expression, visitorContext: VisitorContext) {
    return ts.createStrictEquality(ts.createTypeOf(accessor), ts.createStringLiteral('boolean'));
}

function visitStringKeyword(node: ts.TypeNode, accessor: ts.Expression, visitorContext: VisitorContext) {
    return ts.createStrictEquality(ts.createTypeOf(accessor), ts.createStringLiteral('string'));
}

function visitInterfaceDeclaration(node: ts.InterfaceDeclaration, accessor: ts.Expression, visitorContext: VisitorContext): ts.Expression {
    const typeArguments = visitorContext.typeArgumentsStack[visitorContext.typeArgumentsStack.length - 1];
    const conditions: ts.Expression[] = [];
    conditions.push(ts.createStrictEquality(ts.createTypeOf(accessor), ts.createStringLiteral('object')));
    conditions.push(ts.createStrictInequality(accessor, ts.createNull()));

    const typeParameterTypes = node.typeParameters === undefined
        ? undefined
        : node.typeParameters.map((typeParameter) => visitorContext.checker.getTypeAtLocation(typeParameter));

    if (node.heritageClauses) {
        for (const heritageClause of node.heritageClauses) {
            for (const heritageType of heritageClause.types) {
                if (ts.isIdentifier(heritageType.expression)) {
                    const heritageTypeArguments = heritageType.typeArguments === undefined
                        ? undefined
                        : heritageType.typeArguments.map((typeArgument) => {
                            const type = visitorContext.checker.getTypeFromTypeNode(typeArgument);
                            let typeNode = typeArgument;
                            if (typeArguments !== undefined && typeParameterTypes !== undefined) {
                                const index = typeParameterTypes.findIndex((typeParameterType) => typeParameterType === type);
                                if (index >= 0) {
                                    typeNode = typeArguments[index];
                                }
                            }
                            return typeNode;
                        });
                    const type = visitorContext.checker.getTypeAtLocation(heritageType.expression);
                    visitorContext.typeArgumentsStack.push(ts.createNodeArray(heritageTypeArguments));
                    const expression = type.symbol.declarations
                        .map((declaration) => visitDeclaration(declaration, accessor, visitorContext))
                        .reduce((condition, expression) =>
                            ts.createBinary(
                                condition,
                                ts.SyntaxKind.AmpersandAmpersandToken,
                                expression
                            )
                        );
                    conditions.push(expression);
                    visitorContext.typeArgumentsStack.pop();
                } else {
                    throw new Error('Expected heritage type expression to be an identifier.');
                }
            }
        }
    }

    for (const member of node.members) {
        if (ts.isPropertySignature(member)) {
            const memberAccessor = ts.createPropertyAccess(accessor, tsutils.getPropertyName(member.name));
            if (member.type !== undefined) {
                let typeNode = member.type;
                if (typeArguments !== undefined) {
                    const type = visitorContext.checker.getTypeFromTypeNode(member.type);
                    let matchedTypeArgumentIndex = -1;
                    if (typeParameterTypes !== undefined) {
                        matchedTypeArgumentIndex = typeParameterTypes.findIndex((typeParameterType) => typeParameterType === type);
                    }
                    if (matchedTypeArgumentIndex >= 0) {
                        typeNode = typeArguments[matchedTypeArgumentIndex];
                    }
                }
                // TODO: member optional
                conditions.push(visitTypeNode(typeNode, memberAccessor, visitorContext));
            }
        }
    }

    return conditions.reduce((condition, expression) =>
        ts.createBinary(
            condition,
            ts.SyntaxKind.AmpersandAmpersandToken,
            expression
        )
    );
}

function visitMappedTypeNode(node: ts.MappedTypeNode, accessor: ts.Expression, visitorContext: VisitorContext): ts.Expression {
    // type Pick<T, K extends keyof T> = {
    //     [P in K]: T[P];
    // };

    // node.typeParameter -> name=P, constraint=K -> [P in K]
    // node.type (isIndexedAccessTypeNode) -> objectType=T, indexType=P -> T[P]

    if (node.type !== undefined) {
        if (ts.isIndexedAccessTypeNode(node.type)) {
            // TODO:
        }
    }
    console.log(node.type);
    console.log(node.typeParameter);
    debugger;
    return ts.createTrue();
}

function visitPropertyName(node: ts.PropertyName, accessor: ts.Expression, visitorContext: VisitorContext): ts.Expression {
    // Identifier | StringLiteral | NumericLiteral | ComputedPropertyName
    if (ts.isIdentifier(node)) {
        return ts.createStringLiteral(node.text);
    } else if (ts.isStringLiteral(node)) {
        return ts.createStringLiteral(node.text);
    } else if (ts.isNumericLiteral(node)) {
        return ts.createStringLiteral(node.text);
    } else {
        return node.expression;
    }
}

function visitPropertySignature(node: ts.PropertySignature, accessor: ts.Expression, visitorContext: VisitorContext) {
    const propertyAccessor = ts.createElementAccess(accessor, visitPropertyName(node.name, accessor, visitorContext));
    // TODO: node.questionToken
    if (node.type === undefined) {
        throw new Error('Visiting property without type.');
    }
    const type = visitorContext.checker.getTypeFromTypeNode(node.type);
    return visitType(type, propertyAccessor, visitorContext);
}

function visitDeclaration(node: ts.Declaration, accessor: ts.Expression, visitorContext: VisitorContext): ts.Expression {
    if (ts.isInterfaceDeclaration(node)) {
        return visitInterfaceDeclaration(node, accessor, visitorContext);
    } else if (ts.isMappedTypeNode(node)) {
        return visitMappedTypeNode(node, accessor, visitorContext);
    } else if (ts.isTypeParameterDeclaration(node)) {
        throw new Error('Unbound type parameter: ' + node.getText() + ' at ' + reportNode(node));
    } else if (ts.isPropertySignature(node)) {
        return visitPropertySignature(node, accessor, visitorContext);
    } else {
        throw new Error('Unsupported declaration kind: ' + node.kind);
    }
}

function visitTypeReference(type: ts.TypeReference, accessor: ts.Expression, visitorContext: VisitorContext): ts.Expression {
    const mappers: ((source: ts.Type) => ts.Type | undefined)[] = [];
    if (tsutils.isTypeReference(type) && tsutils.isInterfaceType(type.target)) {
        const baseTypes = visitorContext.checker.getBaseTypes(type.target);
        for (const baseType of baseTypes) {
            if (tsutils.isTypeReference(baseType) && baseType.target.typeParameters !== undefined && baseType.typeArguments !== undefined) {
                const typeParameters = baseType.target.typeParameters;
                const typeArguments = baseType.typeArguments;
                mappers.push((source: ts.Type) => {
                    for (let i = 0; i < typeParameters.length; i++) {
                        if (source === typeParameters[i]) {
                            return typeArguments[i];
                        }
                    }
                });
            }
        }
    }
    if (tsutils.isTypeReference(type) && type.target.typeParameters !== undefined && type.typeArguments !== undefined) {
        const typeParameters = type.target.typeParameters;
        const typeArguments = type.typeArguments;
        mappers.push((source: ts.Type) => {
            for (let i = 0; i < typeParameters.length; i++) {
                if (source === typeParameters[i]) {
                    return typeArguments[i];
                }
            }
        });
    }
    const mapper = mappers.reduce<(source: ts.Type) => ts.Type | undefined>((previous, next) => (source: ts.Type) => previous(source) || next(source), () => undefined);
    if ((type.flags & ts.TypeFlags.Object) !== 0) {
        const conditions: ts.Expression[] = [
            ts.createStrictEquality(
                ts.createTypeOf(accessor),
                ts.createStringLiteral('object')
            ),
            ts.createStrictInequality(
                accessor,
                ts.createNull()
            )
        ];
        visitorContext.typeMapperStack.push(mapper);
        for (const property of visitorContext.checker.getPropertiesOfType(type)) {
            conditions.push(visitDeclaration(property.valueDeclaration, accessor, visitorContext));
        }
        visitorContext.typeMapperStack.pop();
        return conditions.reduce((condition, expression) =>
            ts.createBinary(
                condition,
                ts.SyntaxKind.AmpersandAmpersandToken,
                expression
            )
        );
    } else if ((type.flags & ts.TypeFlags.TypeParameter) !== 0) {
        const typeMapper = visitorContext.typeMapperStack[visitorContext.typeMapperStack.length - 1];
        if (typeMapper === undefined) {
            throw new Error('Unbound type parameter, missing type mapper.');
        }
        const mappedType = typeMapper(type);
        if (mappedType === undefined) {
            throw new Error('Unbound type parameter, missing type node.');
        }
        return visitType(mappedType, accessor, visitorContext);
    } else {
        throw new Error('Unsupported: type without object type flag.');
    }
}

function visitTypeReferenceNode(node: ts.TypeReferenceNode, accessor: ts.Expression, visitorContext: VisitorContext): ts.Expression {
    const type = visitorContext.checker.getTypeAtLocation(node);
    const mappers: ((source: ts.Type) => ts.Type | undefined)[] = [];
    if (tsutils.isTypeReference(type) && tsutils.isInterfaceType(type.target)) {
        const baseTypes = visitorContext.checker.getBaseTypes(type.target);
        for (const baseType of baseTypes) {
            if (tsutils.isTypeReference(baseType) && baseType.target.typeParameters !== undefined && baseType.typeArguments !== undefined) {
                const typeParameters = baseType.target.typeParameters;
                const typeArguments = baseType.typeArguments;
                mappers.push((source: ts.Type) => {
                    for (let i = 0; i < typeParameters.length; i++) {
                        if (source === typeParameters[i]) {
                            return typeArguments[i];
                        }
                    }
                });
            }
        }
    }
    if (tsutils.isTypeReference(type) && type.target.typeParameters !== undefined && type.typeArguments !== undefined) {
        const typeParameters = type.target.typeParameters;
        const typeArguments = type.typeArguments;
        mappers.push((source: ts.Type) => {
            for (let i = 0; i < typeParameters.length; i++) {
                if (source === typeParameters[i]) {
                    return typeArguments[i];
                }
            }
        });
    }
    const mapper = mappers.reduce<(source: ts.Type) => ts.Type | undefined>((previous, next) => (source: ts.Type) => previous(source) || next(source), () => undefined);
    if (tsutils.isObjectType(type)) {
        const conditions: ts.Expression[] = [
            ts.createStrictEquality(
                ts.createTypeOf(accessor),
                ts.createStringLiteral('object')
            ),
            ts.createStrictInequality(
                accessor,
                ts.createNull()
            )
        ];
        visitorContext.typeMapperStack.push(mapper);
        for (const property of visitorContext.checker.getPropertiesOfType(type)) {
            conditions.push(visitDeclaration(property.valueDeclaration, accessor, visitorContext));
        }
        visitorContext.typeMapperStack.pop();
        return conditions.reduce((condition, expression) =>
            ts.createBinary(
                condition,
                ts.SyntaxKind.AmpersandAmpersandToken,
                expression
            )
        );
    } else {
        throw new Error('Unsupported: type without object type flag.');
    }
}

function visitLiteralType(type: ts.LiteralType, accessor: ts.Expression, visitorContext: VisitorContext) {
    if (typeof type.value === 'string') {
        return ts.createStrictEquality(accessor, ts.createStringLiteral(type.value));
    } else if (typeof type.value === 'number') {
        return ts.createStrictEquality(accessor, ts.createNumericLiteral(type.value.toString()));
    } else {
        throw new Error('Type value is expected to be a string or number.');
    }
}

function visitLiteralTypeNode(node: ts.LiteralTypeNode, accessor: ts.Expression, visitorContext: VisitorContext) {
    if (ts.isStringLiteral(node.literal)) {
        return ts.createStrictEquality(accessor, ts.createStringLiteral(node.literal.text));
    } else {
        throw new Error('Unsupported LiteralTypeNode kind: ' + node.kind);
    }
}

function visitType(type: ts.Type, accessor: ts.Expression, visitorContext: VisitorContext): ts.Expression {
    if ((ts.TypeFlags.Number & type.flags) !== 0) {
        return ts.createStrictEquality(ts.createTypeOf(accessor), ts.createStringLiteral('number'));
    } else if ((ts.TypeFlags.Boolean & type.flags) !== 0) {
        return ts.createStrictEquality(ts.createTypeOf(accessor), ts.createStringLiteral('boolean'));
    } else if ((ts.TypeFlags.String & type.flags) !== 0) {
        return ts.createStrictEquality(ts.createTypeOf(accessor), ts.createStringLiteral('string'));
    } else if ((ts.TypeFlags.TypeParameter & type.flags) !== 0) {
        const typeMapper = visitorContext.typeMapperStack[visitorContext.typeMapperStack.length - 1];
        if (typeMapper === undefined) {
            throw new Error('Unbound type parameter, missing type mapper.');
        }
        const mappedType = typeMapper(type);
        if (mappedType === undefined) {
            throw new Error('Unbound type parameter, missing type node.');
        }
        return visitType(mappedType, accessor, visitorContext);
    } else if (tsutils.isTypeReference(type)) {
        return visitTypeReference(type, accessor, visitorContext);
    } else if (tsutils.isLiteralType(type)) {
        return visitLiteralType(type, accessor, visitorContext);
    } else {
        throw new Error('Unsupported type with flags: ' + type.flags);
    }
}

export function visitTypeNode(node: ts.TypeNode, accessor: ts.Expression, visitorContext: VisitorContext) {
    // const type = visitorContext.checker.getTypeFromTypeNode(node);
    // return visitType(type, accessor, visitorContext);
    /* if (node.kind === ts.SyntaxKind.AnyKeyword) {
        name = 'any';
    } else if (node.kind === ts.SyntaxKind.UnknownKeyword) {
        name = 'unknown';
    } else*/
    if (node.kind === ts.SyntaxKind.NumberKeyword) {
        return visitNumberKeyword(node, accessor, visitorContext);
        /*} else if (node.kind === ts.SyntaxKind.ObjectKeyword) {
            name = 'object';*/
    } else if (node.kind === ts.SyntaxKind.BooleanKeyword) {
        return visitBooleanKeyword(node, accessor, visitorContext);
    } else if (node.kind === ts.SyntaxKind.StringKeyword) {
        return visitStringKeyword(node, accessor, visitorContext);
        /*} else if (node.kind === ts.SyntaxKind.VoidKeyword) {
            name = 'void';
        } else if (node.kind === ts.SyntaxKind.UndefinedKeyword) {
            name = 'undefined';
        } else if (node.kind === ts.SyntaxKind.NullKeyword) {
            name = 'null';
        } else if (node.kind === ts.SyntaxKind.NeverKeyword) {
            name = 'never';
        }*/
    } else if (ts.isTypeReferenceNode(node)) {
        return visitTypeReferenceNode(node, accessor, visitorContext);
    } else if (ts.isLiteralTypeNode(node)) {
        return visitLiteralTypeNode(node, accessor, visitorContext);
    } else {
        throw new Error('Unsupported TypeNode kind: ' + node.kind);
    }
}
