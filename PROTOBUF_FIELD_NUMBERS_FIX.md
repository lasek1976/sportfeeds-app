# ProtoBuf Field Numbers Fix - 2026-02-12

## Problem Identified

The clean DTOs had **WRONG ProtoMember field numbers**, which caused JavaScript deserialization to fail. The nested collections (Markets, Teams, ScoreBoards, etc.) were coming back empty.

## Root Causes

### 1. Wrong Field Numbers in CleanDataEventDiff

**BEFORE (WRONG)**:
```csharp
[ProtoMember(60)] public List<CleanDataMarketDiff> Markets { get; set; }
[ProtoMember(61)] public List<CleanDataTeamDiff> Teams { get; set; }
[ProtoMember(62)] public List<CleanDataScoreBoardDiff> ScoreBoards { get; set; }
```

**AFTER (CORRECT)**:
```csharp
[ProtoMember(11)] public List<CleanDataProviderDetailsDiff> ProviderDetails { get; set; }
[ProtoMember(14)] public List<CleanDataMarketDiff> Markets { get; set; }
[ProtoMember(15)] public List<CleanDataTeamDiff> Teams { get; set; }
[ProtoMember(16)] public List<CleanDataScoreBoardDiff> ScoreBoards { get; set; }
[ProtoMember(37)] public List<CleanDataResultDiff> Results { get; set; }
[ProtoMember(47)] public CleanDataStreamingDiff? Streaming { get; set; }
[ProtoMember(48)] public int SportDiffType { get; set; }
[ProtoMember(49)] public int CategoryDiffType { get; set; }
[ProtoMember(50)] public int TournamentDiffType { get; set; }
[ProtoMember(51)] public List<CleanDataProposalSuperComboClientDiff> PropSuperCombo { get; set; }
[ProtoMember(52)] public int MatchType { get; set; }
[ProtoMember(53)] public int EventMarketGroupType { get; set; }
[ProtoMember(54)] public bool IsWizardBetBuilderEligible { get; set; }
```

### 2. Missing Nested Types

The following clean DTOs were **missing** and have been created:

1. **CleanDataProviderDetailsDiff.cs** - Provider details (field 11)
2. **CleanDataResultDiff.cs** - Match results (field 37)
3. **CleanDataStreamingDiff.cs** - Streaming info (field 47)
4. **CleanDataProposalSuperComboClientDiff.cs** - Combo proposals (field 51)
5. **CleanDataRoundInfo** - Round information (nested in ProviderDetails)
6. **CleanDataProvider** - Provider info (nested in ProviderDetails)

## Field Number Mapping (from proto/sportfeeds.proto)

### DataEventDiff Fields
```
Field 1:  IDSport
Field 2:  IDCategory
Field 3:  IDTournament
Field 4:  IDEvent
Field 5:  EventDate (int64 ticks)
Field 6:  StartDate (int64 ticks)
Field 7:  EndDate (int64 ticks)
Field 8:  EventName
Field 9:  EventNameTranslations (SKIPPED - Dictionary)
Field 10: MPath
Field 11: ProviderDetails (repeated CleanDataProviderDetailsDiff) ✅ NOW INCLUDED
Field 12: HasResults
Field 14: Markets (repeated CleanDataMarketDiff) ✅ FIXED FIELD NUMBER
Field 15: Teams (repeated CleanDataTeamDiff) ✅ FIXED FIELD NUMBER
Field 16: ScoreBoards (repeated CleanDataScoreBoardDiff) ✅ FIXED FIELD NUMBER
Field 25: MatchTime (int64 ticks)
Field 26: StopBetting
Field 27: IDEventType
Field 28: TournamentName
Field 29: IsAntepost
Field 30: TournamentNameTranslations (SKIPPED - Dictionary)
Field 31: SportName
Field 32: SportNameTranslations (SKIPPED - Dictionary)
Field 33: TopLeagueEventRank
Field 34: TournamentMPath
Field 35: CategoryNameTranslations (SKIPPED - Dictionary)
Field 36: CategoryName
Field 37: Results (repeated CleanDataResultDiff) ✅ NOW INCLUDED
Field 38: SportOrder
Field 39: MostPlacedRank
Field 40: IDCalendar
Field 41: AamsId
Field 42: AamsIDSport
Field 43: IsSettlement
Field 44: CategoryMPath
Field 45: AamsIDTournament
Field 46: AamsTournamentName
Field 47: Streaming (CleanDataStreamingDiff) ✅ NOW INCLUDED
Field 48: SportDiffType
Field 49: CategoryDiffType
Field 50: TournamentDiffType
Field 51: PropSuperCombo (repeated CleanDataProposalSuperComboClientDiff) ✅ NOW INCLUDED
Field 52: MatchType
Field 53: EventMarketGroupType
Field 54: IsWizardBetBuilderEligible

Field 101: CreatedUTCTime (int64 ticks)
Field 102: DiffType
Field 103: DifferenceProperties
```

## All Clean DTO Files

### Core DTOs
1. ✅ **CleanDataFeedsDiff.cs** - Root message
2. ✅ **CleanDataEventDiff.cs** - Event data (FIXED field numbers)

### Nested Collections
3. ✅ **CleanDataMarketDiff.cs** - Betting markets
4. ✅ **CleanDataSelectionDiff.cs** - Market selections
5. ✅ **CleanDataTeamDiff.cs** - Team information
6. ✅ **CleanDataScoreBoardDiff.cs** - Live scores
7. ✅ **CleanDataProviderDetailsDiff.cs** - Provider details (NEW)
8. ✅ **CleanDataResultDiff.cs** - Match results (NEW)
9. ✅ **CleanDataStreamingDiff.cs** - Streaming info (NEW)
10. ✅ **CleanDataProposalSuperComboClientDiff.cs** - Combo proposals (NEW)

## Key Conversions Applied

### DateTime → long (Ticks)
- EventDate, StartDate, EndDate
- CreatedUTCTime
- ProviderDate
- UpdatedTime (in Results)

### TimeSpan → long (Ticks)
- MatchTime

### Enums → int
- DiffType
- SportDiffType, CategoryDiffType, TournamentDiffType
- SelectionStatus
- ProgramStatus

### Dictionary Fields → SKIPPED
- EventNameTranslations
- TournamentNameTranslations
- SportNameTranslations
- CategoryNameTranslations
- MarketNameTranslations
- SelectionNameTranslations
- TeamTranslationDictionary

## Build Status

✅ **Compilation: SUCCESS** (0 errors, 141 warnings)

## Next Steps for Testing

1. **Connect to VPN** to access MongoDB servers
2. **Start Node.js server**: `npm start`
3. **Start .NET bridge**: `dotnet run`
4. **Verify in logs**:
   - Events count > 0
   - Markets count > 0
   - Teams count > 0
   - ScoreBoards count > 0
   - ProviderDetails count > 0
   - Results count > 0
   - All event properties populated (names, dates, etc.)
5. **Check JavaScript client** in browser - all nested collections should now deserialize correctly!

## Critical Success Criteria

✅ No field 504 (inheritance discriminator)
✅ Correct ProtoMember field numbers matching proto file exactly
✅ All DateTime/TimeSpan converted to int64 ticks
✅ No Dictionary fields (skipped)
✅ Complete nested hierarchy (Markets → Selections, etc.)
✅ All nested collections included (ProviderDetails, Results, Streaming, PropSuperCombo)
