// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { TranslationBenchBenchmarkAction } from "../../synthesizer/benchmark.js";
import type { TranslationBenchParameterScoreSpec } from "../../runner/runner.js";

export interface SealToolsTypeAgentOverride {
    reason: string;
    expectedActions?: TranslationBenchBenchmarkAction[];
    excludeFromScoring?: boolean;
    parameterScore?: Array<TranslationBenchParameterScoreSpec | undefined>;
    parameterScoreByAction?: Record<
        string,
        Omit<TranslationBenchParameterScoreSpec, "defaultMode">
    >;
}

const overrides: Readonly<Record<string, SealToolsTypeAgentOverride>> = {
    "sealtools-dev-easy-6": {
        reason: "The request refers to a specified address but provides no address.",
        excludeFromScoring: true,
    },
    "sealtools-dev-easy-38": {
        reason: "Source gold invents an audio/clips/ path prefix.",
        expectedActions: [
            {
                schemaName: "sealtools",
                actionName: "analyzeSpeechEmotion",
                parameters: { audio_file: "clip1.m4a" },
            },
        ],
    },
    "sealtools-dev-easy-42": {
        reason: "Source gold uses 2006 instead of the requested 15 years.",
        expectedActions: [
            {
                schemaName: "sealtools",
                actionName: "getSalaryBenchmark",
                parameters: {
                    job_role: "Marketing Manager",
                    location: "Bangalore",
                    years_experience: 15,
                },
            },
        ],
    },
    "sealtools-dev-easy-46": {
        reason: "The request is English to French, not Spanish to French.",
        expectedActions: [
            {
                schemaName: "sealtools",
                actionName: "translateWord",
                parameters: {
                    word: "What time is it?",
                    source_language: "English",
                    target_language: "French",
                },
            },
        ],
    },
    "sealtools-dev-easy-51": {
        reason: "Source gold invents an IP address as the required dance style.",
        excludeFromScoring: true,
    },
    "sealtools-dev-easy-55": {
        reason: "The request does not specify the required cloud resource type.",
        excludeFromScoring: true,
    },
    "sealtools-dev-easy-61": {
        reason: "The request omits all three required lift inputs.",
        excludeFromScoring: true,
    },
    "sealtools-dev-easy-71": {
        reason: "The route field accepts the route number without repeating 'bus route'.",
        parameterScoreByAction: {
            getPublicTransportationInfo: {
                acceptedValues: { route: ["10", "route 10"] },
            },
        },
    },
    "sealtools-dev-easy-72": {
        reason: "The request gives an input type but no required input data or path.",
        excludeFromScoring: true,
    },
    "sealtools-dev-easy-75": {
        reason: "The request supplies only a generic processor configuration, so equivalent nonempty wording is acceptable.",
        parameterScoreByAction: {
            estimateExecutionTime: {
                fields: { system_config: "nonempty" },
            },
        },
    },
    "sealtools-dev-easy-78": {
        reason: "The source request is truncated and omits required soil properties.",
        excludeFromScoring: true,
    },
    "sealtools-dev-easy-82": {
        reason: "The schema defines command as a free-form string and does not communicate the gold open_valve convention.",
        parameterScore: [{ fields: { command: "nonempty" } }],
    },
    "sealtools-dev-easy-92": {
        reason: "Source gold invents a /home/user/application/ path prefix.",
        expectedActions: [
            {
                schemaName: "sealtools",
                actionName: "deployApplication",
                parameters: {
                    server: "192.168.77.71",
                    application_file: "app.py",
                },
            },
        ],
    },
    "sealtools-dev-easy-101": {
        reason: "The request refers to a given address but provides no address.",
        excludeFromScoring: true,
    },
    "sealtools-dev-easy-105": {
        reason: "The request matches moveRobot, not the automotive driveRobot API.",
        expectedActions: [
            {
                schemaName: "sealtools",
                actionName: "moveRobot",
                parameters: { robot_id: "97", direction: "forward" },
            },
        ],
    },
    "sealtools-dev-easy-117": {
        reason: "Source gold invents a user/images/ path prefix.",
        expectedActions: [
            {
                schemaName: "sealtools",
                actionName: "rotateImage",
                parameters: { image_path: "image1.jpg", angle: 18 },
            },
        ],
    },
    "sealtools-dev-easy-124": {
        reason: "Source gold paraphrases instead of preserving the supplied document.",
        expectedActions: [
            {
                schemaName: "sealtools",
                actionName: "performCopyEditing",
                parameters: { document: "the technical manual" },
            },
        ],
    },
    "sealtools-dev-easy-125": {
        reason: "Source gold invents a random gender instead of the stated unknown value.",
        expectedActions: [
            {
                schemaName: "sealtools",
                actionName: "getHealthBehavior",
                parameters: {
                    age: 75,
                    gender: "unknown",
                    time_period: "10:31",
                    categorical_var: "education",
                },
            },
        ],
    },
    "sealtools-dev-easy-145": {
        reason: "The request says 'grasp objects'; the gold paraphrases it as 'grasping'.",
        parameterScoreByAction: {
            trainRobot: {
                acceptedValues: { task: ["grasp objects"] },
            },
        },
    },
    "sealtools-dev-easy-152": {
        reason: "Source gold has a stray ')' after the requested color code.",
        expectedActions: [
            {
                schemaName: "sealtools",
                actionName: "convertToRGB",
                parameters: { color_code: "50%" },
            },
        ],
    },
    "sealtools-dev-easy-163": {
        reason: "The request matches checkSpelling(word), not spellCheck(text).",
        expectedActions: [
            {
                schemaName: "sealtools",
                actionName: "checkSpelling",
                parameters: { word: "to" },
            },
        ],
    },
    "sealtools-dev-easy-162": {
        reason: "The request asks to format text but supplies no required text.",
        excludeFromScoring: true,
    },
    "sealtools-dev-easy-185": {
        reason: "The request asks for six items but does not specify the required items.",
        excludeFromScoring: true,
    },
    "sealtools-dev-easy-189": {
        reason: "The request supplies two opaque IDs, but none of the five candidate APIs accepts an ID; source gold places them in dance_style and gender.",
        excludeFromScoring: true,
    },
    "sealtools-dev-easy-193": {
        reason: "The request omits the required water chemistry parameter.",
        excludeFromScoring: true,
    },
    "sealtools-dev-easy-199": {
        reason: "The request omits every required deployWebsite parameter.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-202": {
        reason: "Source gold invents a library ID; the request names Central Library.",
        parameterScoreByAction: {
            getLibraryMetadata: {
                acceptedValues: { library_id: ["Central Library"] },
            },
        },
    },
    "sealtools-dev-difficult-208": {
        reason: "The German input asks for general language detection; source gold incorrectly selects detectMalay.",
        expectedActions: [
            {
                schemaName: "sealtools",
                actionName: "getLanguageDetection",
                parameters: { text: "Ich bin froh, dich zu sehen." },
            },
            {
                schemaName: "sealtools",
                actionName: "getExpressionPattern",
                parameters: {
                    gene: "BRCA1",
                    development_stage: "embryonic",
                },
            },
            {
                schemaName: "sealtools",
                actionName: "getAnatomicalStructure",
                parameters: { species: "lion", organ: "heart" },
            },
        ],
    },
    "sealtools-dev-difficult-209": {
        reason: "The shipment details are free-form text copied or lightly paraphrased from the request.",
        parameterScoreByAction: {
            updateShipmentDetails: {
                fields: { new_details: "nonempty" },
            },
        },
    },
    "sealtools-dev-difficult-215": {
        reason: "Source gold restores hidden numeric precision and uses a string for a numeric frequency.",
        parameterScoreByAction: {
            calculateSludgeProduction: {
                acceptedValues: { flow_rate: [0.985] },
            },
            estimateCustomerLifetimeValue: {
                acceptedValues: { average_purchase_frequency: [1] },
            },
        },
    },
    "sealtools-dev-difficult-244": {
        reason: "The request gives September 30 without a year; the source gold invents 2022.",
        parameterScoreByAction: {
            getFlightSchedule: {
                acceptedValues: { date: ["2026-09-30"] },
            },
        },
    },
    "sealtools-dev-difficult-253": {
        reason: "The request uses the plural 'defendants'; the source gold changes it to singular.",
        parameterScoreByAction: {
            getLegalCaseInfo: {
                acceptedValues: { parties_involved: ["defendants"] },
            },
        },
    },
    "sealtools-dev-difficult-255": {
        reason: "The request asks for separate Google and Bing rankings; source gold contains one unqualified ranking call.",
        expectedActions: [
            {
                schemaName: "sealtools",
                actionName: "optimizeInventory",
                parameters: { product_id: "ABC123", demand_forecast: 50.5 },
            },
            {
                schemaName: "sealtools",
                actionName: "getKeywordRanking",
                parameters: {
                    keyword: "data science",
                    search_engine: "Google",
                },
            },
            {
                schemaName: "sealtools",
                actionName: "getKeywordRanking",
                parameters: {
                    keyword: "data science",
                    search_engine: "Bing",
                },
            },
            {
                schemaName: "sealtools",
                actionName: "generateCopy",
                parameters: { product_name: "Deluxe Coffee Maker" },
            },
        ],
    },
    "sealtools-dev-difficult-291": {
        reason: "Source gold duplicates the single sentiment request with a second classifier call.",
        expectedActions: [
            {
                schemaName: "sealtools",
                actionName: "analyzeSentiment",
                parameters: {
                    text: "I love this product",
                    language: "English",
                },
            },
            {
                schemaName: "sealtools",
                actionName: "createBrochureDesign",
                parameters: {
                    title: "Explore the Enchanting Landscapes",
                    size: "A4",
                    layout: "trifold",
                },
            },
            {
                schemaName: "sealtools",
                actionName: "renderImage",
                parameters: {
                    image_width: 800,
                    image_height: 600,
                    camera_position: "front",
                    render_mode: "shaded",
                },
            },
        ],
    },
    "sealtools-dev-difficult-316": {
        reason: "The request says 'past week'; the source gold paraphrases it as 'weekly'.",
        parameterScoreByAction: {
            getCOVIDCases: {
                acceptedValues: { timeframe: ["past week"] },
            },
        },
    },
    "sealtools-dev-difficult-333": {
        reason: "The request refers to specified slope inputs but does not provide their values; source gold invents both.",
        parameterScoreByAction: {
            analyzeSlopeStability: {
                fields: {
                    slope_geometry: "nonempty",
                    soil_properties: "nonempty",
                },
            },
        },
    },
    "sealtools-dev-difficult-341": {
        reason: "The request says 'primary data center'; the source gold drops 'primary'.",
        parameterScoreByAction: {
            performFailover: {
                acceptedValues: {
                    source_location: ["primary data center"],
                },
            },
        },
    },
    "sealtools-dev-difficult-362": {
        reason: "Source gold restores hidden precision beyond the requested revenue of 0.65.",
        parameterScoreByAction: {
            calculateROI: {
                acceptedValues: { revenue_generated: [0.65] },
            },
        },
    },
    "sealtools-dev-difficult-370": {
        reason: "The request names the Downloads folder without requiring a trailing slash.",
        parameterScoreByAction: {
            downloadData: {
                acceptedValues: { destination: ["Downloads"] },
            },
        },
    },
    "sealtools-dev-difficult-372": {
        reason: "Source gold expands the request's generic hospital and river values.",
        parameterScoreByAction: {
            getWastewaterTreatmentProcess: {
                acceptedValues: {
                    facility_name: ["hospital", "a hospital"],
                },
            },
            getWaterQuality: {
                acceptedValues: { location: ["river", "a river"] },
            },
        },
    },
    "sealtools-dev-difficult-411": {
        reason: "The transcribed record may preserve the request's terminal period.",
        parameterScoreByAction: {
            transcribeMedicalRecord: {
                acceptedValues: {
                    record: [
                        "Patient name: John Smith, Age: 35, Gender: Male.",
                    ],
                },
            },
        },
    },
    "sealtools-dev-difficult-418": {
        reason: "The source-data field is unconstrained free-form text; source gold changes spaces to underscores.",
        parameterScoreByAction: {
            transformData: {
                fields: { source_data: "nonempty" },
            },
        },
    },
    "sealtools-dev-difficult-427": {
        reason: "The request does not name the required researcher; source gold invents Dr. Julia Thompson.",
        parameterScoreByAction: {
            calculateResearchImpact: {
                fields: { researcher: "ignore" },
            },
        },
    },
    "sealtools-dev-difficult-438": {
        reason: "The final action is conditional on a prior runtime result and cannot be represented by flat gold actions.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-440": {
        reason: "Source gold adds unrelated research-submission and protein-analysis calls absent from the request.",
        expectedActions: [
            {
                schemaName: "sealtools",
                actionName: "createPressRelease",
                parameters: {
                    product_name: "Samsung Galaxy S21",
                    event_date: "January 1st, 2022",
                    target_audience: "Media professionals",
                    key_message: "Embrace change and welcome new opportunities",
                    company_name: "LMN Industries",
                },
            },
        ],
    },
    "sealtools-dev-difficult-447": {
        reason: "The ticket resolution is a free-form description of restarting the server.",
        parameterScoreByAction: {
            resolveTicket: {
                fields: { resolution: "nonempty" },
            },
        },
    },
    "sealtools-dev-difficult-449": {
        reason: "The request supplies generic free-form text rather than the source gold's rewritten sentences.",
        parameterScoreByAction: {
            highlightMistakes: {
                fields: { text: "nonempty" },
            },
            getCopyEdits: {
                fields: { document: "nonempty" },
            },
        },
    },
    "sealtools-dev-difficult-452": {
        reason: "The source gold replaces spaces with underscores and removes a space around the parameter value.",
        parameterScoreByAction: {
            analyzeBrainActivity: {
                acceptedValues: {
                    method: ["spike sorting"],
                    parameters: ["time window=10ms"],
                },
            },
        },
    },
    "sealtools-dev-difficult-497": {
        reason: "Source gold corrupts the apostrophe in Prisoner's Dilemma.",
        parameterScoreByAction: {
            getGamePayoff: {
                acceptedValues: { game: ["Prisoner's Dilemma"] },
            },
        },
    },
    "sealtools-dev-difficult-480": {
        reason: "Source gold invents the Tylenol brand and omits the explicitly requested side-effects call.",
        expectedActions: [
            {
                schemaName: "sealtools",
                actionName: "calculateProteinFoldability",
                parameters: { protein_sequence: "MALWQDKAKG" },
            },
            {
                schemaName: "sealtools",
                actionName: "getHematologyParameters",
                parameters: {},
            },
            {
                schemaName: "sealtools",
                actionName: "getDrugInfo",
                parameters: {
                    drug_name: "Aspirin",
                    dosage: "500 mg",
                    patient_age: 30,
                },
            },
            {
                schemaName: "sealtools",
                actionName: "getDrugSideEffects",
                parameters: { drug_name: "Aspirin" },
            },
        ],
    },
    "sealtools-dev-difficult-509": {
        reason: "The request names Cloud Foundry with a space; source gold removes it.",
        parameterScoreByAction: {
            createCloudNativeApp: {
                acceptedValues: { app_name: ["Cloud Foundry"] },
            },
        },
    },
    "sealtools-dev-difficult-510": {
        reason: "The request says 'patient engagement'; source gold changes the space to an underscore.",
        parameterScoreByAction: {
            getMarketingMaterials: {
                acceptedValues: { topic: ["patient engagement"] },
            },
        },
    },
    "sealtools-dev-difficult-516": {
        reason: "The request names the United States; source gold normalizes it to USA without a schema contract.",
        parameterScoreByAction: {
            getGlobalHealthData: {
                acceptedValues: { country: ["United States"] },
            },
            getCountryInfo: {
                acceptedValues: { country: ["United States"] },
            },
        },
    },
    "sealtools-dev-difficult-518": {
        reason: "The request states costs and benefits in millions; converting them to base-dollar values is valid.",
        parameterScoreByAction: {
            calculateCostBenefit: {
                acceptedValues: {
                    costs: [34900000],
                    benefits: [10400000],
                },
            },
        },
    },
    "sealtools-dev-difficult-524": {
        reason: "Source gold adds an unrelated endocrinology call absent from the request.",
        expectedActions: [
            {
                schemaName: "sealtools",
                actionName: "getAcupuncturePoints",
                parameters: { animal_type: "dog", condition: "arthritis" },
            },
            {
                schemaName: "sealtools",
                actionName: "getGeriatricAssessment",
                parameters: { age: 72 },
            },
            {
                schemaName: "sealtools",
                actionName: "getNeurologicalTestResults",
                parameters: {
                    patient_id: "Twb1kRBU",
                    test_type: "EEG",
                    date_range: "2021-01-01 to 2021-12-31",
                },
            },
        ],
    },
    "sealtools-dev-difficult-532": {
        reason: "The request specifies 2025-07-15; source gold changes the year to 2022.",
        parameterScoreByAction: {
            getRehabilitationNursingAssessment: {
                acceptedValues: { date: ["2025-07-15"] },
            },
        },
    },
    "sealtools-dev-difficult-555": {
        reason: "The request asks for employee name and title in addition to productivity; source gold omits that call.",
        expectedActions: [
            {
                schemaName: "sealtools",
                actionName: "getEmployeeProductivity",
                parameters: { employee_id: "EMP2578" },
            },
            {
                schemaName: "sealtools",
                actionName: "getEmployeeDetails",
                parameters: { employee_id: "EMP2578" },
            },
            {
                schemaName: "sealtools",
                actionName: "getDepartmentBudget",
                parameters: { department: "Sales" },
            },
            {
                schemaName: "sealtools",
                actionName: "getEducationStats",
                parameters: { location: "United States", year: 2021 },
            },
        ],
    },
    "sealtools-dev-difficult-566": {
        reason: "The request supports two synonymous case-count APIs and requires three time periods; the single-call gold is ambiguous.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-570": {
        reason: "Source gold adds unrelated brand-deletion and product-detail calls absent from the request.",
        expectedActions: [
            {
                schemaName: "sealtools",
                actionName: "createPromotionCampaign",
                parameters: {
                    campaign_name: "Summer Sale",
                    start_date: "2022-06-01",
                    end_date: "2022-08-31",
                    budget: 10000,
                    target_audience: "young professionals",
                    promotion_message: "50% off on select items",
                },
            },
        ],
    },
    "sealtools-dev-difficult-584": {
        reason: "Source gold invents a /data/ prefix not present in the requested file name.",
        parameterScoreByAction: {
            saveFile: {
                acceptedValues: { file_path: ["file2.csv"] },
            },
        },
    },
    "sealtools-dev-difficult-601": {
        reason: "The request expresses the funding range with 'to'; source gold rewrites it with a hyphen.",
        parameterScoreByAction: {
            getResearchFunding: {
                acceptedValues: {
                    amount_range: ["$100,000 to $500,000"],
                },
            },
        },
    },
    "sealtools-dev-difficult-652": {
        reason: "The mathematical-linguistics input is free-form text copied or lightly paraphrased from the request.",
        parameterScoreByAction: {
            analyzeMathematicalLinguistics: {
                fields: { text: "nonempty" },
            },
        },
    },
    "sealtools-dev-difficult-657": {
        reason: "The required production quantity is absent from the request; source gold invents 21.",
        parameterScoreByAction: {
            calculateChemicalConsumption: {
                fields: { production_quantity: "ignore" },
            },
        },
    },
    "sealtools-dev-difficult-676": {
        reason: "The frequency schema is numeric; one purchase per month is represented as 1 rather than the invalid gold string.",
        parameterScoreByAction: {
            estimateCustomerLifetimeValue: {
                acceptedValues: { average_purchase_frequency: [1] },
            },
        },
    },
    "sealtools-dev-easy-35": {
        reason: "The request allows all alphanumeric characters; source gold narrows the whitelist to ABC123.",
        parameterScoreByAction: {
            applyOCR: {
                acceptedValues: {
                    whitelist: [
                        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
                    ],
                },
            },
        },
    },
    "sealtools-dev-easy-192": {
        reason: "The schema requires centimeters, so converting the requested 39.3 inches to 99.822 centimeters is valid.",
        parameterScoreByAction: {
            getSeatComfort: {
                acceptedValues: { driver_height: [99.822] },
            },
        },
    },
    "sealtools-dev-difficult-211": {
        reason: "Borrowing the book is conditional on a runtime permission result and cannot be represented by flat gold actions.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-213": {
        reason: "The request supplies customer information as 'Name - John Doe'; source gold drops the label.",
        parameterScoreByAction: {
            getReturnInstructions: {
                acceptedValues: { customer_info: ["Name - John Doe"] },
            },
        },
    },
    "sealtools-dev-difficult-227": {
        reason: "Filing the claim depends on a runtime policy lookup, and the request supplies no policy number.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-228": {
        reason: "Source gold requires getEthicsInDemocracy, but that action is absent from the row's candidate tools.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-230": {
        reason: "Source gold adds an unrelated public-health-laws call and rewrites the supplied health-condition list.",
        expectedActions: [
            {
                schemaName: "sealtools",
                actionName: "getLaborPolicy",
                parameters: { country: "United States" },
            },
            {
                schemaName: "sealtools",
                actionName: "checkEthicalViolation",
                parameters: { action: "Insider trading" },
            },
            {
                schemaName: "sealtools",
                actionName: "getWellBeingScore",
                parameters: {
                    name: "NCWz36fha",
                    age: 48,
                    gender: "male",
                    location: "New York City",
                    health_conditions: "diabetes, hypertension, depression",
                },
            },
        ],
        parameterScoreByAction: {
            getWellBeingScore: {
                acceptedValues: {
                    health_conditions: [
                        "diabetes, hypertension, and depression",
                    ],
                },
            },
        },
    },
    "sealtools-dev-difficult-241": {
        reason: "Source gold requires sendMarketingEmail, but that action is absent from the row's candidate tools.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-254": {
        reason: "The innovation description is unconstrained free-form text copied or lightly paraphrased from the request.",
        parameterScoreByAction: {
            addInnovation: {
                fields: { description: "nonempty" },
            },
        },
    },
    "sealtools-dev-difficult-257": {
        reason: "The request omits the year for all three dates; source gold invents 2022.",
        parameterScoreByAction: {
            getHousekeepingSchedule: {
                acceptedValues: { date: ["2026-05-30"] },
            },
            bookHotel: {
                acceptedValues: {
                    check_in_date: ["2026-10-15"],
                    check_out_date: ["2026-10-20"],
                },
            },
            checkSpaAvailability: {
                acceptedValues: { date: ["2026-10-15"] },
            },
        },
    },
    "sealtools-dev-difficult-265": {
        reason: "The publicity dates omit a year, and the research abstract is free-form text from the request.",
        parameterScoreByAction: {
            getPublicityData: {
                acceptedValues: {
                    start_date: ["2026-01-01"],
                    end_date: ["2026-01-31"],
                },
            },
            submitResearch: {
                fields: { abstract: "nonempty" },
            },
        },
    },
    "sealtools-dev-difficult-268": {
        reason: "Submitting the ticket is conditional on a runtime resolution result and cannot be represented by flat gold actions.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-276": {
        reason: "The policy field is free-form text that preserves the request's effective date.",
        parameterScoreByAction: {
            updateLibraryPolicy: {
                acceptedValues: {
                    policy: ["Latest version, effective from 2022-01-01"],
                },
            },
        },
    },
    "sealtools-dev-difficult-286": {
        reason: "The request omits the required fitness user, and both cancer and cancer research express the requested topic.",
        parameterScoreByAction: {
            getFitnessRewards: {
                fields: { user: "ignore" },
            },
            getResearchReliability: {
                acceptedValues: { keywords: ["cancer"] },
            },
        },
    },
    "sealtools-dev-difficult-295": {
        reason: "The violation description is unconstrained free-form text copied or lightly paraphrased from the request.",
        parameterScoreByAction: {
            reportAnimalEthicsViolation: {
                fields: { description: "nonempty" },
            },
        },
    },
    "sealtools-dev-difficult-319": {
        reason: "The request can validly map to either public-transportation information or the more specific subway-schedule API.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-321": {
        reason: "The request supplies neither the conversation text nor an audio file and exposes two synonymous transcription APIs.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-324": {
        reason: "Source gold invents an organization name, while the campaign description is unconstrained free-form text.",
        parameterScoreByAction: {
            createFundraisingCampaign: {
                fields: { description: "nonempty" },
            },
            submitGrantProposal: {
                acceptedValues: {
                    organization_name: ["our non-profit organization"],
                },
            },
        },
    },
    "sealtools-dev-difficult-325": {
        reason: "Collision inputs depend on a prior runtime calculation and are not supplied in the request.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-326": {
        reason: "Liverpool and Liverpool FC identify the same requested football team.",
        parameterScoreByAction: {
            getTeamInfo: {
                acceptedValues: { team_name: ["Liverpool FC"] },
            },
        },
    },
    "sealtools-dev-difficult-332": {
        reason: "The request can validly map to either plotScatter or the synonymous createScatterPlot API.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-339": {
        reason: "The dental-records field is unconstrained free-form input; source gold invents an opaque record ID.",
        parameterScoreByAction: {
            analyzeDentalRecords: {
                fields: { dental_records: "nonempty" },
            },
        },
    },
    "sealtools-dev-difficult-361": {
        reason: "The job description and requirements are unconstrained free-form text copied or lightly paraphrased from the request.",
        parameterScoreByAction: {
            createJobPosting: {
                fields: {
                    description: "nonempty",
                    requirements: "nonempty",
                },
            },
        },
    },
    "sealtools-dev-difficult-369": {
        reason: "The patient information and dental records are unconstrained free-form text copied or lightly paraphrased from the request.",
        parameterScoreByAction: {
            analyzeDentalRecords: {
                fields: {
                    patient_information: "nonempty",
                    dental_records: "nonempty",
                },
            },
        },
    },
    "sealtools-dev-difficult-373": {
        reason: "The proofreading request supplies no text; source gold invents a sample sentence.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-382": {
        reason: "The request supplies neither the required password nor the requested graphic-design update values; source gold invents a password.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-388": {
        reason: "The request omits the required concentration difference and area; source gold invents both values.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-407": {
        reason: "The requested UX modification and post-change satisfaction depend on runtime results that flat gold cannot represent.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-419": {
        reason: "Source gold requires getHorseAge, but that action is absent from the row's candidate tools.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-430": {
        reason: "The job description and requirements are unconstrained free-form text; source gold invents one exact description.",
        parameterScoreByAction: {
            createJobPosting: {
                fields: {
                    description: "nonempty",
                    requirements: "nonempty",
                },
            },
        },
    },
    "sealtools-dev-difficult-446": {
        reason: "The anatomy lookup is conditional on a runtime spelling result and cannot be represented by flat gold actions.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-479": {
        reason: "The website URL is valid with or without an explicit HTTPS scheme.",
        parameterScoreByAction: {
            checkWebAccessibility: {
                acceptedValues: {
                    website_url: ["library2.org/accessibility"],
                },
            },
        },
    },
    "sealtools-dev-difficult-482": {
        reason: "The request omits required COD, establishment, asset, and metadata values and refers to values that will be provided later.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-491": {
        reason: "The request explicitly asks for ethics guidelines, but getEthicsGuidelines is absent from the row's candidate tools and source gold omits the request.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-502": {
        reason: "The source request is truncated at the advertisement budget, omits the requested brand values, and source gold adds an unrelated library-policy call.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-514": {
        reason: "The trafficking lookup depends on a prior runtime fingerprint result and cannot be represented by flat gold actions.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-515": {
        reason: "The available travel API retrieves expenses rather than planning a trip, and the required transaction date is absent from the request.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-520": {
        reason: "Publishing is conditional on a runtime device-classification result and cannot be represented by flat gold actions.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-529": {
        reason: "Network deletion and restart depend on prior runtime results and cannot be represented by flat gold actions.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-530": {
        reason: "The required bullet image is absent; source gold invents image123 from a visual description.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-546": {
        reason: "Recipe instructions are unconstrained free-form text copied or lightly paraphrased from the request.",
        parameterScoreByAction: {
            createRecipe: {
                fields: { instructions: "nonempty" },
            },
        },
    },
    "sealtools-dev-difficult-550": {
        reason: "The request omits the year for May 20, and the crane-availability request does not identify a unique candidate action sequence.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-568": {
        reason: "The questionnaire and document fields are unconstrained free-form text copied or lightly paraphrased from the request.",
        parameterScoreByAction: {
            getBehavioralProfile: {
                fields: { questionnaire: "nonempty" },
            },
            getCopyEdits: {
                fields: { document: "nonempty" },
            },
        },
    },
    "sealtools-dev-difficult-574": {
        reason: "The corpse description is unconstrained free-form text copied or lightly paraphrased from the request.",
        parameterScoreByAction: {
            estimateTimeSinceDeath: {
                fields: { corpse: "nonempty" },
            },
        },
    },
    "sealtools-dev-difficult-588": {
        reason: "The request gives June dates without a year; source gold invents 2022.",
        parameterScoreByAction: {
            createAd: {
                acceptedValues: {
                    start_date: ["June 1st"],
                    end_date: ["June 30th"],
                },
            },
        },
    },
    "sealtools-dev-difficult-598": {
        reason: "The request contains a blank image link, so visual-culture analysis cannot be executed.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-611": {
        reason: "The request supplies neither the required image nor the requested alternative text; source gold invents a file name.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-616": {
        reason: "The environmental report consumes prior imaging and nuclear-energy runtime results that flat gold cannot represent.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-617": {
        reason: "The downstream drug-crime research consumes prior distribution data that flat gold cannot represent.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-622": {
        reason: "The current and desired process states are unconstrained free-form text copied or lightly paraphrased from the request.",
        parameterScoreByAction: {
            analyzeBusinessProcess: {
                fields: {
                    current_state: "nonempty",
                    desired_state: "nonempty",
                },
            },
        },
    },
    "sealtools-dev-difficult-623": {
        reason: "Source gold invents the product description and omits the requested downstream analysis.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-650": {
        reason: "The request supplies no required bullet image; source gold invents a file path.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-659": {
        reason: "The request names a dataset of grapes; source gold rewrites it as the singular Grape.",
        parameterScoreByAction: {
            preprocessData: {
                acceptedValues: { data: ["dataset of grapes"] },
            },
        },
    },
    "sealtools-dev-difficult-664": {
        reason: "The source request is truncated mid-sentence and source gold adds three unrelated fashion and public-relations calls.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-679": {
        reason: "The ticket issue and resolution are unconstrained free-form text copied or lightly paraphrased from the request.",
        parameterScoreByAction: {
            createSupportTicket: {
                fields: { issue_description: "nonempty" },
            },
            resolveTicket: {
                fields: { resolution: "nonempty" },
            },
        },
    },
    "sealtools-dev-difficult-685": {
        reason: "Source gold invents unknown additional information instead of using or omitting the request's analysis goal.",
        parameterScoreByAction: {
            analyzeSubstance: {
                fields: { additional_info: "ignore" },
            },
        },
    },
    "sealtools-dev-difficult-693": {
        reason: "The infrastructure field is unconstrained free-form text copied or lightly paraphrased from the request.",
        parameterScoreByAction: {
            analyzeMigrationFeasibility: {
                fields: { current_infrastructure: "nonempty" },
            },
        },
    },
    "sealtools-dev-difficult-297": {
        reason: "Source gold contains three unrelated calls absent from the request.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-549": {
        reason: "The source request is a truncated serialized API call.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-572": {
        reason: "Source gold contains two unrelated calls absent from the request.",
        excludeFromScoring: true,
    },
    "sealtools-dev-easy-63": {
        reason: "performRobotTask and robotTask have equivalent contracts for this request, so the gold route is ambiguous.",
        excludeFromScoring: true,
    },
    "sealtools-dev-easy-69": {
        reason: "The request omits the required location; source gold invents 'country'.",
        excludeFromScoring: true,
    },
    "sealtools-dev-easy-126": {
        reason: "The request says reducing power usage; source gold shortens the free-form objective to power.",
        parameterScoreByAction: {
            optimizeVLSICircuit: {
                acceptedValues: { objective: ["reducing power usage"] },
            },
        },
    },
    "sealtools-dev-difficult-221": {
        reason: "Tibia bone and Tibia identify the same requested bone.",
        parameterScoreByAction: {
            analyzeSkeleton: {
                acceptedValues: { skeleton: ["Tibia bone"] },
            },
        },
    },
    "sealtools-dev-difficult-234": {
        reason: "Adding the crop is conditional on a runtime result and cannot be represented by flat gold actions.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-247": {
        reason: "Updating the insurance coverage is conditional on a runtime availability result.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-273": {
        reason: "Budget constraints and budget express the same free-form design constraint.",
        parameterScoreByAction: {
            getDesignStrategy: {
                acceptedValues: { constraints: ["budget constraints"] },
            },
        },
    },
    "sealtools-dev-difficult-287": {
        reason: "The requested DNA bases are equivalent with or without spaces after commas.",
        parameterScoreByAction: {
            simulateDNASequence: {
                acceptedValues: { bases: ["A,T,C,G", "A, T, C, G"] },
            },
        },
    },
    "sealtools-dev-difficult-296": {
        reason: "The request asks for oncology treatment options, but none of the candidate tools supports that request.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-298": {
        reason: "Checkout is conditional on a runtime permission result and cannot be represented by flat gold actions.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-303": {
        reason: "Aspirin matches the generic getDrugSideEffects contract, not the psychopharmacology-specific medication contract selected by source gold.",
        expectedActions: [
            {
                schemaName: "sealtools",
                actionName: "getDrugDosage",
                parameters: { drug_name: "Aspirin" },
            },
            {
                schemaName: "sealtools",
                actionName: "getDrugSideEffects",
                parameters: { drug_name: "Aspirin" },
            },
            {
                schemaName: "sealtools",
                actionName: "getPsychologicalDisorder",
                parameters: { disorder_name: "Anxiety" },
            },
        ],
    },
    "sealtools-dev-difficult-329": {
        reason: "The lighting lookup is conditional on a runtime Aspirin-availability result.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-344": {
        reason: "getArchLaw and getArchitecturalLaw have equivalent contracts for this request, so the gold route is ambiguous.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-394": {
        reason: "The candidate exploratory-data-analysis APIs overlap, and neither yields a unique valid action for all requested checks.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-400": {
        reason: "The record and evidence fields preserve or lightly paraphrase free-form text from the request.",
        parameterScoreByAction: {
            analyzeDentalRecords: {
                acceptedValues: {
                    patient_information: ["Name: John Smith"],
                    dental_records: [
                        "No cavities found.",
                        "Dental records indicate no cavities found.",
                    ],
                },
            },
            analyzeForensicEvidence: {
                acceptedValues: { evidence: ["ballistics evidence"] },
            },
        },
    },
    "sealtools-dev-difficult-410": {
        reason: "United States and USA identify the same requested country.",
        parameterScoreByAction: {
            getEconomicAnthropologyData: {
                acceptedValues: { country: ["United States"] },
            },
        },
    },
    "sealtools-dev-difficult-441": {
        reason: "analyzeSpeechAct and getSpeechAct have overlapping contracts for this request, so the gold route is ambiguous.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-459": {
        reason: "The request omits the required HTML and supplies only free-form Spark input/output descriptions that source gold invents.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-475": {
        reason: "The contamination follow-up is conditional on a runtime result and cannot be represented by flat gold actions.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-490": {
        reason: "The request's phone number and road values are valid free-form forms of the source gold values.",
        parameterScoreByAction: {
            getLayerAttribute: {
                acceptedValues: {
                    attribute_name: ["phone number"],
                    layer_name: ["road"],
                },
            },
        },
    },
    "sealtools-dev-difficult-493": {
        reason: "Claim submission is conditional on a runtime amount check and cannot be represented by flat gold actions.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-525": {
        reason: "Democratic and Democratic party identify the same requested political party as the source gold's Democrat.",
        parameterScoreByAction: {
            getPoliticalAttitudes: {
                acceptedValues: {
                    political_party: ["Democratic", "Democratic party"],
                },
            },
        },
    },
    "sealtools-dev-difficult-526": {
        reason: "No candidate tool accepts both the veterinary-patient and location inputs, so the requested action set is not uniquely answerable.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-528": {
        reason: "scheduleCampaign requires DD/MM/YYYY; source gold uses the invalid end date 01/31/2023.",
        expectedActions: [
            {
                schemaName: "sealtools",
                actionName: "createPromotionCampaign",
                parameters: {
                    campaign_name: "Holiday Sale",
                    start_date: "2022-11-25",
                    end_date: "2022-12-31",
                    budget: 10000,
                    target_audience: "online shoppers",
                    promotion_message: "Get 20% off on all orders!",
                },
            },
            {
                schemaName: "sealtools",
                actionName: "getLearningObjectives",
                parameters: { course_id: 123456 },
            },
            {
                schemaName: "sealtools",
                actionName: "scheduleCampaign",
                parameters: {
                    campaign_name: "New Year Campaign",
                    start_date: "01/01/2023",
                    end_date: "31/01/2023",
                    target_audience: "existing customers",
                },
            },
        ],
    },
    "sealtools-dev-difficult-558": {
        reason: "The broad and specific chemical-element APIs overlap for Oxygen, so the required action set is ambiguous.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-561": {
        reason: "The refugee lookup is conditional on a runtime signature-validity result.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-583": {
        reason: "The request asks for JSON output but supplies no required audit data; source gold invents a parameter value.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-593": {
        reason: "The UI changes field is unconstrained free-form text copied or lightly paraphrased from the request.",
        parameterScoreByAction: {
            updateUI: {
                fields: { changes: "nonempty" },
            },
        },
    },
    "sealtools-dev-difficult-605": {
        reason: "getArchitecturalLaw and getArchLaw have equivalent contracts for this request, so the gold route is ambiguous.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-609": {
        reason: "The source gold flattens a runtime-conditional access and job workflow into unconditional actions.",
        excludeFromScoring: true,
    },
    "sealtools-dev-difficult-658": {
        reason: "The software-documentation field is unconstrained free-form text copied or lightly paraphrased from the request.",
        parameterScoreByAction: {
            updateSoftwareDocumentation: {
                fields: { document: "nonempty" },
            },
        },
    },
    "sealtools-dev-difficult-660": {
        reason: "The study purpose is unconstrained free-form text copied or lightly paraphrased from the request.",
        parameterScoreByAction: {
            getPrivacyViolationRisk: {
                acceptedValues: {
                    purpose: [
                        "study",
                        "conducting a study",
                        "study on privacy risks",
                        "study on the privacy risks associated with user information",
                    ],
                },
            },
        },
    },
    "sealtools-dev-difficult-699": {
        reason: "The duration and horse-species values preserve valid wording from the request.",
        parameterScoreByAction: {
            getSpaceBiologyResearch: {
                acceptedValues: { duration: ["few weeks", "a few weeks"] },
            },
            getAnimalReproductiveInfo: {
                acceptedValues: { animal_type: ["horses"] },
            },
            estimateVaccineEfficacy: {
                acceptedValues: { animal_species: ["horses"] },
            },
        },
    },
};

export function getSealToolsTypeAgentOverride(
    caseId: string,
): SealToolsTypeAgentOverride | undefined {
    return overrides[caseId];
}
