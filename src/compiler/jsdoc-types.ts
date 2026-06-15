import type { InputVariable } from "@inlang/sdk";
import { renderInputMatchTypeVariants } from "./match-literals.js";
import { isValidIdentifier, quotePropertyKey } from "./variable-access.js";

export type InputMatchDefinition = {
	literals: Set<string>;
	hasCatchAll: boolean;
}

export type InputMatchTypes = {
	definition: Map<
		string,
		InputMatchDefinition
	>,

	// Variable dependency graph for each variant
	matchVariants: { optional: boolean, matches: { key: string, value: string }[], usedKeys: Set<string> }[]
};

type OverrideDefinition = { keys: string[], optional: boolean, override: string };

export function jsDocBundleFunctionTypes(args: {
	inputs: InputVariable[];
	locales: string[];
	matchTypes?: InputMatchTypes;
	inputTypeOverride?: string;
}): string {
	const localesUnion = args.locales.map((locale) => `"${locale}"`).join(" | ");
	const inputType =
		args.inputTypeOverride ?? inputsType(args.inputs, args.matchTypes);

	return `
* @param {${inputType}} inputs
* @param {{ locale?: ${localesUnion} }} options
* @returns {LocalizedString}`;
}

/**
 * Returns the types for the input variables.
 *
 * @example
 *   const inputs = [{ name: "age" }]
 *   inputsType(inputs)
 *   >> "{ age: NonNullable<unknown> }"
 */
export function inputsType(
	inputs: InputVariable[],
	matchTypes?: InputMatchTypes
): string {
	if (inputs.length === 0) {
		return "{}";
	}

	// Deduplicate inputs by name to avoid TypeScript errors with duplicate properties in JSDoc
	const uniqueInputMap = new Map<string, InputVariable>();

	for (const input of inputs) {
		uniqueInputMap.set(input.name, input);
	}

	const uniqueInputs = Array.from(uniqueInputMap.values());

	const generate = (identifiers?: string[], literalOverride?: Map<string, OverrideDefinition>) => {
		return uniqueInputs
			.reduce<string[]>((result, input) => {
				if (identifiers && !identifiers.includes(input.name))
					return result;

				const name = isValidIdentifier(input.name)
					? input.name
					: quotePropertyKey(input.name);

				let optional = false;
				let typeName: string;

				const override = literalOverride?.get(input.name);
				if (override) {
					typeName = override.override;
					optional = override.optional;
				} else {
					const resolved = resolveInputType(input.name, matchTypes);
					optional = resolved.optional ?? false;
					typeName = resolved.typeName;
				}

				const namePostfix = optional ? "?" : "";

				result.push(`${name}${namePostfix}: ${typeName}`)
				return result;
			}, [])
			.join(", ");
	}

	if (matchTypes) {
		const variableValues = matchTypes.matchVariants.reduce<Map<string, Set<string>>>(
			(result, value) => {
				for (const match of value.matches) {
					let values = result.get(match.key);
					if (!values) {
						values = new Set();
						result.set(match.key, values);
					}

					values.add(match.value);
				}
				return result;
			}, new Map());

		const result = matchTypes.matchVariants.map<string>((value) => {
			if (value.matches.length === 0)
				return `{ ${generate()} }`

			const matchKeys = value.matches.map(value => value.key);
			const usedKeys = [...matchKeys, ...Array.from(value.usedKeys)];

			const overrideMap: Map<string, OverrideDefinition> = new Map();
			usedKeys.forEach((key) => {
				const usedMatchKeys = Array.from(variableValues.get(key) ?? []);
				if (usedMatchKeys.length === 0) return;

				let matchValues: string[] = [];
				if (value.matches.length !== 0) {
					matchValues = value.matches.length === 1 ? value.matches
						.map(match => match.value) :
						usedMatchKeys
				}

				const overrideValue = matchValues
					.flatMap((value) => {
						if (value.length !== 0)
							return renderInputMatchTypeVariants(value)

						return "undefined";
					})
					.filter((value, index, values) => values.indexOf(value) === index)
					.join(" | ");

				const override = { keys: matchKeys, override: overrideValue, optional: value.optional };
				overrideMap.set(key, override);
			})

			return `{ ${generate(usedKeys, overrideMap)} }`;
		});

		return Array.from(new Set(result)).join(" | ");
	} else {
		return `{ ${generate()} }`;
	}
}

function resolveInputType(name: string, matchTypes?: InputMatchTypes): {
	optional?: boolean,
	typeName: string
} {
	let typeName = "NonNullable<unknown>";
	if (!matchTypes) return { typeName };

	const info = matchTypes.definition.get(name);
	if (!info) return { typeName };

	const literals = Array.from(info.literals);
	if (literals.length === 0) return { typeName };

	literals.sort();
	typeName = literals
		.flatMap((value) => renderInputMatchTypeVariants(value))
		.filter((value, index, values) => values.indexOf(value) === index)
		.join(" | ");

	return { typeName, optional: info.hasCatchAll }
}

export function inputTypeForName(
	name: string,
	matchTypes?: InputMatchTypes
): string {
	return resolveInputType(name, matchTypes).typeName;
}
