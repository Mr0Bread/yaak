import {
	useAtomValue
} from 'jotai';
import { graphqlSchemaAtom } from "../atoms/graphqlSchemaAtom";
import { Input } from "./core/Input";
import type {
	GraphQLSchema,
	GraphQLOutputType,
	GraphQLField,
	GraphQLList,
	GraphQLInputType,
	GraphQLNonNull,
	GraphQLObjectType,
	GraphQLFieldMap,
	GraphQLInterfaceType,
} from "graphql";
import { isNonNullType, isListType, isLeafType, isUnionType, isObjectType, isInterfaceType, isScalarType } from "graphql";
import { Button } from "./core/Button";
import { useEffect, useState } from 'react';
import { IconButton } from "./core/IconButton";
import { fuzzyFilter } from 'fuzzbunny';

function isObjectLikeType(type: unknown): type is (GraphQLObjectType | GraphQLInterfaceType) {
	return isObjectType(type) || isInterfaceType(type)
}

function getRootTypes(graphqlSchema: GraphQLSchema) {
	return ([
		graphqlSchema.getQueryType(),
		graphqlSchema.getMutationType(),
		graphqlSchema.getSubscriptionType(),
	]
		.filter(Boolean) as NonNullable<ReturnType<GraphQLSchema['getQueryType']>>[])
		.reduce(
			(
				prev,
				curr
			) => {
				return {
					...prev,
					[curr.name]: curr,
				};
			},
			{} as Record<string, NonNullable<ReturnType<GraphQLSchema['getQueryType']>>>
		)
}

function visitTypeIndices(type: GraphQLAnyType, indices: Map<string, SearchIndexRecord>) {
	if (!isObjectLikeType(type)) {
		return Array.from(indices.values());
	}

	if (indices.has(type.name)) {
		return Array.from(indices.values());
	}

	indices.set(type.name, {
		name: type.name,
		type: 'type',
	});

	if (type.getFields()) {
		visitFieldsIndices(type.getFields(), indices);
	}
}

function visitFieldsIndices(fieldMap: FieldsMap, indices: Map<string, SearchIndexRecord>) {
	for (const field of Object.values(fieldMap)) {
		if (!field.name) {
			return;
		}

		if (indices.has(field.name)) {
			return;
		}

		indices.set(field.name, {
			name: field.name,
			type: 'field',
		});

		if (field.type) {
			visitTypeIndices(field.type, indices);
		}
	}
}

function getFieldsIndices(fieldMap: FieldsMap): SearchIndexRecord[] {
	const indices: Map<string, SearchIndexRecord> = new Map();

	visitFieldsIndices(fieldMap, indices);

	return Array.from(indices.values())
}

type Field = GraphQLField<any, any>;
type FieldsMap = GraphQLFieldMap<any, any>;
type GraphQLAnyType = FieldsMap[string]['type'];

type SearchIndexRecord = {
	name: string,
	type: 'field' | 'type' | 'query' | 'mutation' | 'subscription',
};

type SchemaPointer = Field | GraphQLOutputType | GraphQLInputType | null;

type ViewMode = 'explorer' | 'search' | 'field';

type HistoryRecord = { schemaPointer: SchemaPointer, viewMode: ViewMode };

function DocsExplorer({
						  graphqlSchema
					  }: { graphqlSchema: GraphQLSchema }) {
	const [rootTypes, setRootTypes] = useState(getRootTypes(graphqlSchema));
	const [schemaPointer, setSchemaPointer] = useState<SchemaPointer>(null);
	const [history, setHistory] = useState<HistoryRecord[]>([]);
	const [searchIndex, setSearchIndex] = useState<SearchIndexRecord[]>([]);
	const [searchQuery, setSearchQuery] = useState<string>('');
	const [searchResults, setSearchResults] = useState<SearchIndexRecord[]>([]);
	const [viewMode, setViewMode] = useState<ViewMode>('explorer');
	const [isSearchDropdownOpen, setSearchDropdownOpen] = useState(false);

	useEffect(() => {
		setRootTypes(getRootTypes(graphqlSchema));
	}, [graphqlSchema]);

	useEffect(() => {
		const typeMap = graphqlSchema.getTypeMap();

		const index: SearchIndexRecord[] = Object.values(typeMap)
			.filter(
				(x) => !x.name.startsWith('__')
			)
			.map(
				(x) => ({
					name: x.name,
					type: 'type',
				})
			);

		Object.values(rootTypes)
			.forEach(
				(type) => {
					index.push(
						...getFieldsIndices(type.getFields())
					)
				}
			)

		setSearchIndex(
			index
				.filter(
					(x, i, array) => array.findIndex(
						(y) => y.name === x.name && y.type === x.type
					) === i
				)
		);
	}, [graphqlSchema, rootTypes]);

	useEffect(
		() => {
			if (!searchQuery) {
				setSearchResults([]);
				return;
			}

			const results = fuzzyFilter(
				searchIndex,
				searchQuery,
				{ fields: ['name'] }
			)
				.sort((a, b) => b.score - a.score)
				.map((v) => v.item);

			setSearchResults(results);
		},
		[searchIndex, searchQuery]
	);

	const goBack = () => {
		if (history.length === 0) {
			return;
		}

		const newHistory = history.slice(0, history.length - 1);

		const prevHistoryRecord = newHistory[newHistory.length - 1];

		if (prevHistoryRecord) {
			const { schemaPointer: newPointer, viewMode } = prevHistoryRecord;
			setHistory(newHistory);
			setSchemaPointer(newPointer!);
			setViewMode(viewMode);

			return;
		}

		goHome();
	}

	const addToHistory = (historyRecord: HistoryRecord) => {
		setHistory([...history, historyRecord]);
	}

	const goHome = () => {
		setHistory([]);
		setSchemaPointer(null);
		setViewMode('explorer');
	}

	const renderRootTypes = () => {
		return (
			<div
				className="mt-5 flex flex-col gap-3"
			>
				{
					Object
						.values(rootTypes)
						.map(
							(x) => (
								<button
									key={ x.name }
									className="block text-primary cursor-pointer w-fit"
									onClick={
										() => {
											addToHistory({
												schemaPointer: x,
												viewMode: 'explorer',
											});
											setSchemaPointer(x);
										}
									}
								>
									{ x.name }
								</button>
							)
						)
				}
			</div>
		);
	}

	const extractActualType = (
		type: GraphQLField<never, never>['type'] | GraphQLInputType
	) => {
		// check if non-null
		if (isNonNullType(type) || isListType(type)) {
			return extractActualType((type as GraphQLNonNull<GraphQLOutputType>).ofType)
		}

		return type;
	}

	const onTypeClick = (
		type: GraphQLField<never, never>['type'] | GraphQLInputType
	) => {
		// check if non-null
		if (isNonNullType(type)) {
			onTypeClick((type as GraphQLNonNull<GraphQLOutputType>).ofType)

			return;
		}

		// check if list
		if (isListType(type)) {
			onTypeClick((type as GraphQLList<GraphQLOutputType>).ofType);

			return;
		}

		setSchemaPointer(type);
		addToHistory({
			schemaPointer: type,
			viewMode: 'explorer',
		});
		setViewMode('explorer');
	};

	const onFieldClick = (field: GraphQLField<any, any>) => {
		setSchemaPointer(field);
		setViewMode('field');
		addToHistory({
			schemaPointer: field,
			viewMode: 'field',
		});
	};

	const renderUnionRecord = (
		type: GraphQLObjectType,
	) => {
		return (
			<div
				className="flex flex-row justify-start items-center"
			>
				<div
					className="flex flex-col"
				>
					<div>
						<span>
							{ " " }
						</span>
						<button
							className="cursor-pointer text-primary"
							onClick={ () => onTypeClick(type) }
						>
							{ type.name }
						</button>
						<span>{ " " }</span>
					</div>
					{
						type.description
							? (
								<div>
									{ type.description }
								</div>
							)
							: null
					}
				</div>
			</div>
		);
	};

	const renderSubFieldRecord = (
		field: FieldsMap[string],
		options?: {
			addable?: boolean,
		}
	) => {
		return (
			<div
				className="flex flex-row justify-start items-center"
			>
				{
					options?.addable
						? (
							<IconButton size="sm" icon="plus_circle" iconColor="secondary" title="Add to query"/>
						)
						: null
				}
				<div
					className="flex flex-col"
				>
					<div>
						<span>
							{ " " }
						</span>
						<button
							className="cursor-pointer text-primary"
							onClick={ () => onFieldClick(field) }
						>
							{ field.name }
						</button>
						{/* Arguments block */ }
						{
							field.args && field.args.length > 0
								? (
									<>
								<span>
									{ " " }
									(
									{ " " }
								</span>
										{
											field.args.map(
												(arg, i, array) => (
													<>
														<button
															key={ arg.name }
															onClick={ () => onTypeClick(arg.type) }
														>
															<span
																className="text-primary cursor-pointer"
															>
																{ arg.name }
															</span>
																	<span>{ " " }</span>
																	<span
																		className="text-success underline cursor-pointer"
																	>{ arg.type.toString() }</span>
																	{
																		i < array.length - 1
																			? (
																				<>
																					<span>{ " " }</span>
																					<span> , </span>
																					<span>{ " " }</span>
																				</>
																			)
																			: null
																	}
														</button>
														<span>{ " " }</span>
													</>
												)
											)
										}
										<span>
									)
								</span>
									</>
								)
								: null
						}
						{/* End of Arguments Block */ }
						<span>{ " " }</span>
						<button
							className="text-success underline cursor-pointer"
							onClick={ () => onTypeClick(field.type) }
						>
							{ field.type.toString() }
						</button>
					</div>
					{
						field.description
							? (
								<div>
									{ field.description }
								</div>
							)
							: null
					}
				</div>
			</div>
		);
	};

	const renderScalarField = () => {
		if (!isLeafType(schemaPointer)) {
			return;
		}
		const scalarField = schemaPointer;

		return (
			<div>
				{ scalarField.toConfig().description }
			</div>
		);
	};

	const renderSubFields = () => {
		if (!schemaPointer) {
			return null;
		}

		if (
			isLeafType(schemaPointer)
		) {
			// Scalar field
			return renderScalarField();
		}

		if (
			isUnionType(schemaPointer)
		) {
			return Object.values(schemaPointer.getTypes())
				.map(
					(x) => renderUnionRecord(x)
				)
		}

		if (
			isObjectLikeType(schemaPointer)
		) {
			return Object.values(schemaPointer.getFields())
				.map(
					(x) => renderSubFieldRecord(x, { addable: isObjectType(schemaPointer) })
				)
		}

		return null;
	};

	const renderFieldDocView = () => {
		if (!schemaPointer) {
			return null;
		}

		return (
			<div>
				<div
					className="text-primary mt-5"
				>
					{ (schemaPointer as Field).name }
				</div>
				{
					isObjectLikeType(schemaPointer)
						? (
							<div
								className="my-3"
							>
								Fields
							</div>
						)
						: null
				}
				<div
					className="flex flex-col gap-7"
				>
					{ renderSubFields() }
				</div>
			</div>
		)
	}

	const renderExplorerView = () => {
		if (history.length === 0) {
			return renderRootTypes();
		}

		return renderFieldDocView()
	};

	const renderFieldView = () => {
		if (!schemaPointer) {
			return null;
		}

		const field = schemaPointer as GraphQLField<any, any>;
		const returnType = extractActualType(field.type);

		return (
			<div>
				<div
					className="text-primary mt-10"
				>
					{ field.name }
				</div>
				{/*  Arguments */}
				{
					field.args && field.args.length > 0
						? (
							<div
								className="mt-8"
							>
								<div>
									Arguments
								</div>
								<div
									className="mt-2"
								>
									<div>
										{
											field.args.map(
												(arg, i, array) => (
													<>
														<button
															key={ arg.name }
															onClick={ () => onTypeClick(arg.type) }
														>
															<span
																className="text-primary cursor-pointer"
															>
																{ arg.name }
															</span>
															<span>{ " " }</span>
															<span
																className="text-success underline cursor-pointer"
															>{ arg.type.toString() }</span>
															{
																i < array.length - 1
																	? (
																		<>
																			<span>{ " " }</span>
																			<span> , </span>
																			<span>{ " " }</span>
																		</>
																	)
																	: null
															}
														</button>
														<span>{ " " }</span>
													</>
												)
											)
										}
									</div>
								</div>
							</div>
						)
						: null
				}
				{/* End of Arguments */}
				{/* Return type	*/}
				<div
					className="mt-8"
				>
					<div>
						Type
					</div>
					<div
						className="text-primary mt-2"
					>
						{ returnType.name }
					</div>
				</div>
				{/* End of Return type	*/}
				{/* Fields */}
				{
					(returnType as GraphQLObjectType).getFields && Object.values((returnType as GraphQLObjectType).getFields()).length > 0
						? (
							<div
								className="mt-8"
							>
								<div>
									Fields
								</div>
								<div
									className="flex flex-col gap-3 mt-2"
								>
									{
										Object.values((returnType as GraphQLObjectType).getFields())
											.map(
												(x) => renderSubFieldRecord(x)
											)
									}
								</div>
							</div>
						)
						: null
				}
				{/* End of Fields */}
			</div>
		);
	};

	const renderTopBar = () => {
		return (
			<div
				className="flex flex-row gap-2"
			>
				<Button
					onClick={ goBack }
				>
					Back
				</Button>
				<IconButton
					onClick={ goHome }
					icon="house"
					title="Go to beginning"
				/>
			</div>
		);
	};

	const renderSearchView = () => {
		return (
			<div>
				<div
					className="mt-5 text-primary"
				>
					Search results
				</div>
				<div
					className="mt-4 flex flex-col gap-3"
				>
					{
						searchResults
							.map(
								(result) => (
									<div
										key={`${result.name}-${result.type}`}
										className="flex flex-row justify-between"
									>
										<div>
											{ result.name }
										</div>
										<div>
											{ result.type }
										</div>
									</div>
								)
							)
					}
				</div>
			</div>
		);
	};

	const renderView = () => {
		if (viewMode === 'field') {
			return renderFieldView();
		}

		if (viewMode === 'search') {
			return renderSearchView();
		}

		return renderExplorerView();
	};

	return (
		<div
			className="overflow-y-auto pe-3"
		>
			<div
				className="min-h-[35px]"
			>
				{
					history.length > 0 || viewMode === 'search'
						? renderTopBar()
						: null
				}
			</div>
			{/* Search bar */}
			<div
				className="relative"
			>
				<Input
					label="Search docs"
					stateKey="search_graphql_docs"
					placeholder="Search docs"
					hideLabel
					defaultValue={searchQuery}
					onChange={
						(value) => {
							setSearchQuery(value);
							setSearchDropdownOpen(true);
						}
					}
					onKeyDown={
						(e) => {
							// check if enter
							if (e.key === 'Enter') {
								addToHistory({
									schemaPointer: null,
									viewMode: 'search',
								})
								setViewMode('search');
								setSearchDropdownOpen(false);
							}
						}
					}
				/>
			</div>
			{/* End of search bar */}
			<div>
				{ renderView() }
			</div>
		</div>
	);
}

export function GraphQLDocsExplorer() {
	const graphqlSchema = useAtomValue(graphqlSchemaAtom);

	if (graphqlSchema) {
		return <DocsExplorer graphqlSchema={ graphqlSchema }/>;
	}

	return <div>There is no schema</div>;
}
