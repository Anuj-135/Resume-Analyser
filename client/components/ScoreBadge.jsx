
const ScoreBadge = ({ score }) => {
    let badgeColor = '';
    let badgeText = '';

    if (score > 70) {
        badgeColor = 'bg-badge-green text-green-600';
        badgeText = 'Strong';
    } else if (score > 49) {
        badgeColor = 'bg-badge-yellow text-yellow-600';
        badgeText = 'Good Start';
    } else {
        badgeColor = 'bg-badge-red text-red-600';
        badgeText = 'Needs Work';
    }

    return (
        <div className={`px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full shrink-0 ${badgeColor}`}>
            <p className="text-xs sm:text-sm font-medium whitespace-nowrap">{badgeText}</p>
        </div>
    );
};

export default ScoreBadge;