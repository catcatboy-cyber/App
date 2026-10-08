import {isAnonymousUser} from '@libs/actions/Session';
import * as API from '@libs/API';
import type {MarkAllMessagesAsReadParams} from '@libs/API/parameters';
import {WRITE_COMMANDS} from '@libs/API/types';
import {getDBTimeWithSkew} from '@libs/NetworkState';
import {isArchivedReport} from '@libs/ReportUtils';

import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import type {Report} from '@src/types/onyx';

import type {ReportNameValuePairsArchivedState} from '@selectors/ReportNameValuePairs';
import type {OnyxCollection} from 'react-native-onyx';

import {DeviceEventEmitter} from 'react-native';
import Onyx from 'react-native-onyx';

// We use connectWithoutView because markAllMessagesAsRead doesn't affect the UI rendering
// and this avoids unnecessary re-rendering in AuthScreen whenever any report is updated
let allReports: OnyxCollection<Report>;
Onyx.connectWithoutView({
    key: ONYXKEYS.COLLECTION.REPORT,
    callback: (value) => (allReports = value),
});

type ReportReadUpdate = {
    lastReadTime: Report['lastReadTime'] | null;
    manuallyMarkedUnreadReportActionID: Report['manuallyMarkedUnreadReportActionID'] | null;
};

/**
 * Newest server-authored time on the report. isUnread() compares lastReadTime against these same fields.
 * A client clock, even with positive skew applied, can be rejected for the whole batch.
 */
function getNewestServerStamp(report: Report): string {
    const lastVisibleActionCreated = report.lastVisibleActionCreated ?? '';
    const lastMentionedTime = report.lastMentionedTime ?? '';
    return lastVisibleActionCreated > lastMentionedTime ? lastVisibleActionCreated : lastMentionedTime;
}

/** A report that is still being created has no server id yet, so it must not join a batch the server will reject. */
function isReportStillBeingCreated(report: Report): boolean {
    const pendingAction = report.pendingFields?.createChat ?? report.pendingFields?.addWorkspaceRoom ?? report.pendingFields?.createReport;
    return pendingAction === CONST.RED_BRICK_ROAD_PENDING_ACTION.ADD;
}

/**
 * Marks the given reports read.
 * `reportIDs` is the Inbox selection (`getReportIDsForTab`). This does not scan Onyx or run `isUnread()` again,
 * because that second check disagrees with the tab (for example a one-expense thread that is already read).
 * An omitted or empty list does nothing.
 */
function markAllMessagesAsRead(reportNameValuePairs: OnyxCollection<ReportNameValuePairsArchivedState>, reportIDs: readonly string[] | undefined) {
    if (isAnonymousUser() || !reportIDs?.length) {
        return;
    }

    const reportsToMark: Report[] = [];
    for (const reportID of reportIDs) {
        const report = allReports?.[`${ONYXKEYS.COLLECTION.REPORT}${reportID}`];
        if (!report?.reportID) {
            continue;
        }

        const isReportArchived = isArchivedReport(reportNameValuePairs?.[`${ONYXKEYS.COLLECTION.REPORT_NAME_VALUE_PAIRS}${report.reportID}`]);
        if (isReportArchived || isReportStillBeingCreated(report)) {
            continue;
        }

        reportsToMark.push(report);
    }

    let newLastReadTime = '';
    for (const report of reportsToMark) {
        const serverStamp = getNewestServerStamp(report);
        if (serverStamp > newLastReadTime) {
            newLastReadTime = serverStamp;
        }
    }
    if (!newLastReadTime) {
        newLastReadTime = getDBTimeWithSkew();
    }

    const optimisticReports: Record<string, ReportReadUpdate> = {};
    const failureReports: Record<string, ReportReadUpdate> = {};
    const reportIDList: string[] = [];
    for (const report of reportsToMark) {
        const previousLastReadTime = report.lastReadTime ?? '';
        // Already caught up to the batch time. Marking it again would put a redundant id in a shared failure rollback.
        if (previousLastReadTime && previousLastReadTime >= newLastReadTime) {
            continue;
        }

        const reportKey = `${ONYXKEYS.COLLECTION.REPORT}${report.reportID}`;
        // The manual anchor pins the in-chat New marker even after lastReadTime moves, so clear it with the read.
        optimisticReports[reportKey] = {
            lastReadTime: newLastReadTime,
            manuallyMarkedUnreadReportActionID: null,
        };
        failureReports[reportKey] = {
            lastReadTime: report.lastReadTime ?? null,
            manuallyMarkedUnreadReportActionID: report.manuallyMarkedUnreadReportActionID ?? null,
        };
        reportIDList.push(report.reportID);
    }

    if (reportIDList.length === 0) {
        return;
    }

    const optimisticData = [
        {
            onyxMethod: Onyx.METHOD.MERGE_COLLECTION,
            key: ONYXKEYS.COLLECTION.REPORT,
            value: optimisticReports,
        },
    ];

    const failureData = [
        {
            onyxMethod: Onyx.METHOD.MERGE_COLLECTION,
            key: ONYXKEYS.COLLECTION.REPORT,
            value: failureReports,
        },
    ];

    const parameters: MarkAllMessagesAsReadParams = {
        reportIDList,
        lastReadTime: newLastReadTime,
    };

    API.write(WRITE_COMMANDS.MARK_ALL_MESSAGES_AS_READ, parameters, {optimisticData, failureData});

    // A mounted chat only moves its local New marker on this event. Single-chat read emits it; the batch has to as well.
    for (const reportID of reportIDList) {
        DeviceEventEmitter.emit(`readNewestAction_${reportID}`, newLastReadTime);
    }
}

export default markAllMessagesAsRead;
