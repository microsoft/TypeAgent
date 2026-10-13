const rows = [
    [
        "reset-top",
        "match-order",
        "How do I reset a password?",
        [
            ["guide", "Open security settings and choose Reset password.", 2],
            ["menu", "The cafeteria menu lists soup today.", 0],
            ["partial", "Account settings include a security section.", 1],
        ],
        ["guide", "partial", "menu"],
    ],
    [
        "calendar-top",
        "match-order",
        "How do I add a calendar event?",
        [
            ["guide", "Choose New event, set the time, and save.", 2],
            ["ad", "Buy a wall calendar.", 0],
            ["partial", "The calendar view can change from week to month.", 1],
        ],
        ["guide", "partial", "ad"],
    ],
    [
        "refund-top",
        "match-order",
        "How do I request a refund?",
        [
            [
                "guide",
                "Open billing, select the charge, and request a refund.",
                2,
            ],
            ["shipping", "Refund shipping boxes are sold in packs of ten.", 0],
            ["partial", "Billing history lists recent charges.", 1],
        ],
        ["guide", "partial", "shipping"],
    ],
    [
        "settings-top",
        "match-order",
        "Where are notification settings?",
        [
            ["guide", "Open Settings and select Notifications.", 2],
            ["ad", "Notification lamps are on sale.", 0],
            ["partial", "Settings also contains display options.", 1],
        ],
        ["guide", "partial", "ad"],
    ],
    [
        "download-top",
        "match-order",
        "How do I download an invoice?",
        [
            ["guide", "Open the invoice and choose Download PDF.", 2],
            ["ad", "Download our shopping app.", 0],
            ["partial", "Invoices are listed under billing.", 1],
        ],
        ["guide", "partial", "ad"],
    ],
    [
        "reset-buried",
        "buried",
        "How do I reset a password?",
        [
            ["ad", "Password notebooks are on sale.", 0],
            ["partial", "Security options live under the account menu.", 1],
            [
                "guide",
                "Choose Reset password and follow the confirmation step.",
                2,
            ],
        ],
        ["ad", "partial", "guide"],
    ],
    [
        "invoice-buried",
        "buried",
        "How do I export invoices?",
        [
            ["ad", "Export-grade paper is discounted.", 0],
            ["partial", "The billing page lists invoice dates.", 1],
            ["guide", "Select invoices and choose Export CSV.", 2],
        ],
        ["ad", "partial", "guide"],
    ],
    [
        "sku-buried",
        "buried",
        "What is the warranty for SKU 440?",
        [
            ["ad", "SKU organizers are available.", 0],
            ["other", "SKU 441 has a one-year warranty.", 0],
            ["guide", "SKU 440 includes a two-year warranty.", 2],
        ],
        ["ad", "other", "guide"],
    ],
    [
        "meeting-buried",
        "buried",
        "Where is the notes template for project Orion?",
        [
            ["ad", "Orion telescopes are on sale.", 0],
            ["partial", "Project pages can store shared notes.", 1],
            [
                "guide",
                "Project Orion uses the shared notes template named Kickoff.",
                2,
            ],
        ],
        ["ad", "partial", "guide"],
    ],
    [
        "csv-tie",
        "tie",
        "How do I export a CSV?",
        [
            ["alpha", "Choose Export and then CSV.", 2],
            ["beta", "Use the Export menu and select CSV.", 2],
            ["photo", "Photo export uses a different dialog.", 0],
        ],
        ["photo", "alpha", "beta"],
    ],
    [
        "photo-tie",
        "tie",
        "How do I rotate a photo?",
        [
            ["alpha", "Select the photo and choose Rotate right.", 2],
            ["beta", "Open the photo and use the rotate control.", 2],
            ["ad", "Rotating stands are on sale.", 0],
        ],
        ["ad", "beta", "alpha"],
    ],
    [
        "partial-tie",
        "tie",
        "Where can I see account security?",
        [
            ["alpha", "The account page mentions security options.", 1],
            ["beta", "Security details are somewhere in account settings.", 1],
            ["ad", "Accountants for hire.", 0],
        ],
        ["ad", "alpha", "beta"],
    ],
    [
        "no-wifi",
        "none",
        "What is the office guest wifi password?",
        [
            ["menu", "Today's lunch menu is soup.", 0],
            ["holiday", "The office is closed on Friday.", 0],
            ["ad", "Buy a new router.", 0],
        ],
        ["menu", "holiday", "ad"],
    ],
    [
        "no-payroll",
        "none",
        "What is the payroll deposit date?",
        [
            ["menu", "The cafe opens at 8.", 0],
            ["holiday", "Parking is free on weekends.", 0],
            ["ad", "Deposit boxes are on sale.", 0],
        ],
        ["ad", "menu", "holiday"],
    ],
    [
        "no-medical",
        "none",
        "Which clinic visit is scheduled for this patient?",
        [
            ["menu", "The break room has tea.", 0],
            ["ad", "Clinic furniture is discounted.", 0],
            ["holiday", "The lab is closed for inventory.", 0],
        ],
        ["holiday", "menu", "ad"],
    ],
    [
        "no-secret",
        "none",
        "What is the API token for the staging service?",
        [
            ["menu", "Staging means the rehearsal room.", 0],
            ["ad", "Token jars are on sale.", 0],
            ["holiday", "The service desk closes at 5.", 0],
        ],
        ["ad", "holiday", "menu"],
    ],
    [
        "cancel-stuffing",
        "adversarial",
        "How do I cancel a subscription?",
        [
            ["stuffed", "cancel subscription cancel subscription buy now", 0],
            ["guide", "Open billing and select Cancel subscription.", 2],
            ["partial", "Subscriptions are listed on the billing page.", 1],
        ],
        ["stuffed", "partial", "guide"],
    ],
    [
        "shipping-stuffing",
        "adversarial",
        "How do I track a shipment?",
        [
            ["stuffed", "track shipment track shipment click here", 0],
            ["guide", "Open orders and choose Track shipment.", 2],
            ["partial", "Orders shows recent delivery dates.", 1],
        ],
        ["stuffed", "partial", "guide"],
    ],
    [
        "password-stuffing",
        "adversarial",
        "How do I change a password?",
        [
            ["stuffed", "change password change password limited offer", 0],
            ["guide", "Open security and choose Change password.", 2],
            ["unrelated", "Password stickers are available at the desk.", 0],
        ],
        ["stuffed", "unrelated", "guide"],
    ],
    [
        "contradictory-refund",
        "adversarial",
        "Can I refund a duplicate charge?",
        [
            ["denial", "Duplicate charges can never be refunded.", 0],
            [
                "guide",
                "Open the duplicate charge and submit a refund request.",
                2,
            ],
            ["partial", "Billing lists duplicate-looking charges.", 1],
        ],
        ["denial", "partial", "guide"],
    ],
    [
        "export-partial",
        "partial",
        "How do I export payroll to CSV?",
        [
            ["partial", "Export options include several file types.", 1],
            ["other", "Photos can be exported as PNG.", 0],
            ["ad", "CSV converters are on sale.", 0],
        ],
        ["ad", "other", "partial"],
    ],
    [
        "policy-partial",
        "partial",
        "What is the guest laptop checkout policy?",
        [
            ["partial", "The front desk handles equipment checkout.", 1],
            ["ad", "Laptop sleeves are discounted.", 0],
            ["other", "Guest parking is limited to two hours.", 0],
        ],
        ["other", "ad", "partial"],
    ],
    [
        "wifi-partial",
        "partial",
        "How do I join the office guest network?",
        [
            ["partial", "Network settings are on the admin page.", 1],
            ["ad", "Guest soaps are on sale.", 0],
            ["other", "The office toaster is in the kitchen.", 0],
        ],
        ["ad", "other", "partial"],
    ],
    [
        "ambiguous-account",
        "partial",
        "Tell me about the account.",
        [
            ["alpha", "The account page has a display name.", 1],
            ["beta", "Account settings include a time zone.", 1],
            ["ad", "Open a bank account today.", 0],
        ],
        ["ad", "beta", "alpha"],
    ],
];

export const cases = rows.map(
    ([id, kind, query, passages, retrievalOrder]) => ({
        id,
        kind,
        query,
        passages: passages.map(([passageId, text, relevance]) => ({
            id: passageId,
            text,
            relevance,
        })),
        retrievalOrder,
    }),
);
