import Foundation

/// Typed access to the app's localized strings.
///
/// Every string the UI displays flows through ``Strings`` so hard-
/// coded literals never leak past this file — which keeps the English
/// + Arabic catalogs in sync.
public enum Strings {
    public enum Common {
        public static let close = String(localized: "common.close")
        public static let cancel = String(localized: "common.cancel")
        public static let confirm = String(localized: "common.confirm")
        public static let `continue` = String(localized: "common.continue")
        public static let retry = String(localized: "common.retry")
        public static let save = String(localized: "common.save")
        public static let delete = String(localized: "common.delete")
        public static let done = String(localized: "common.done")
        public static let back = String(localized: "common.back")
        public static let next = String(localized: "common.next")
        public static let copy = String(localized: "common.copy")
        public static let copied = String(localized: "common.copied")
        public static let share = String(localized: "common.share")
        public static let search = String(localized: "common.search")
        public static let loading = String(localized: "common.loading")
    }

    public enum Lock {
        public static let title = String(localized: "lock.title")
        public static let subtitle = String(localized: "lock.subtitle")
        public static let unlockButton = String(localized: "lock.unlock.button")
        public static let reason = String(localized: "lock.reason")
    }

    public enum Home {
        public static let title = String(localized: "home.title")
    }

    public enum Send {
        public static let title = String(localized: "send.title")
        public static let recipientTitle = String(localized: "send.recipient.title")
        public static let recipientPlaceholder = String(localized: "send.recipient.placeholder")
        public static let amountTitle = String(localized: "send.amount.title")
        public static let reviewTitle = String(localized: "send.review.title")
        public static let reviewSubmit = String(localized: "send.review.submit")
    }

    public enum Activity {
        public static let title = String(localized: "activity.title")
    }

    public enum Security {
        public static let title = String(localized: "security.title")
    }

    public enum Approvals {
        public static let title = String(localized: "approvals.title")
    }

    public enum Onboarding {
        public static let createCTA = String(localized: "onboarding.welcome.cta.create")
        public static let importCTA = String(localized: "onboarding.welcome.cta.import")
        public static let tagline = String(localized: "onboarding.welcome.tagline")
    }
}
