import { useState, useRef, useCallback, useEffect } from 'react';
import { Camera, MapPin, Send, AlertTriangle, CheckCircle2, X, Loader2, Navigation, Sparkles } from 'lucide-react';
import { submitIssue, getIssueStatus } from '../utils/api';
import Spinner from '../components/Spinner';
import LocationName from '../components/LocationName';

const MAX_FILE_SIZE_MB = 10;
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 30; // ~90 seconds before giving up

const AI_STAGES = [
  'Scanning image with computer vision…',
  'Classifying the issue type…',
  'Checking for duplicate reports…',
  'Estimating severity & priority…',
  'Calculating workforce requirements…',
];

export default function UploadPage() {
  const [image, setImage] = useState(null);          // File object
  const [preview, setPreview] = useState(null);      // Object URL for preview
  const [location, setLocation] = useState(null);    // { latitude, longitude, accuracy }
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);  // polling AI status
  const [result, setResult] = useState(null);        // submission result (success/duplicate)
  const [analysisFailed, setAnalysisFailed] = useState(null); // error message string
  const [error, setError] = useState('');

  const fileInputRef = useRef(null);
  const pollRef = useRef(null);

  // ── Geolocation ────────────────────────────────────────────────────────────
  const captureLocation = useCallback(() => {
    setLocationError('');
    setLocationLoading(true);
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser.');
      setLocationLoading(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({
          latitude:  pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy:  Math.round(pos.coords.accuracy), // metres
        });
        setLocationLoading(false);
      },
      () => {
        setLocationError('Unable to retrieve your GPS location. Please allow location access and try again.');
        setLocationLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  // Auto-capture GPS when the page loads
  useEffect(() => { captureLocation(); }, [captureLocation]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ── Image Handling ─────────────────────────────────────────────────────────
  const handleFile = useCallback((file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please upload a valid image file.');
      return;
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setError(`Image must be under ${MAX_FILE_SIZE_MB}MB.`);
      return;
    }
    setError('');
    setImage(file);
    setPreview(URL.createObjectURL(file));
  }, []);

  const handleFileInput = (e) => handleFile(e.target.files[0]);

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const clearImage = () => {
    setImage(null);
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── AI Analysis Polling ────────────────────────────────────────────────────
  // Poll GET /:id/status until analysisStatus is completed/failed.
  const startPolling = useCallback((issueId) => {
    setAnalyzing(true);
    let attempts = 0;

    pollRef.current = setInterval(async () => {
      attempts += 1;
      try {
        const status = await getIssueStatus(issueId);

        if (status.analysisStatus === 'completed') {
          clearInterval(pollRef.current);
          pollRef.current = null;

          if (status.duplicate) {
            setResult({
              message: 'This issue has already been reported and counted.',
              duplicate: true,
              reportCount: status.reportCount,
              originalIssue: status.originalIssue,
            });
          } else {
            setResult({
              message: 'Your issue has been analyzed and dispatched to the right department.',
              duplicate: false,
              issue: status,
            });
          }
          setAnalyzing(false);
        } else if (status.analysisStatus === 'failed') {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setAnalysisFailed(
            'AI analysis could not complete right now. Your report is saved — a team will review it manually.'
          );
          setAnalyzing(false);
        } else if (attempts >= MAX_POLL_ATTEMPTS) {
          // Timeout: report is saved, just notify completion
          clearInterval(pollRef.current);
          pollRef.current = null;
          setAnalysisFailed('Analysis is taking longer than expected. Your report is saved and will be processed shortly.');
          setAnalyzing(false);
        }
      } catch (err) {
        // Transient error — keep polling
        if (attempts >= MAX_POLL_ATTEMPTS) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setAnalysisFailed('Could not reach the analysis service. Your report is saved and will be processed shortly.');
          setAnalyzing(false);
        }
      }
    }, POLL_INTERVAL_MS);
  }, []);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setResult(null);
    setAnalysisFailed(null);

    if (!image) return setError('Please select an image.');
    if (!location) return setError('Please capture your location first.');

    try {
      setLoading(true);
      const formData = new FormData();
      formData.append('image', image);
      formData.append('latitude', location.latitude);
      formData.append('longitude', location.longitude);

      // Returns 202 with issueId — AI runs in the background
      const data = await submitIssue(formData);
      setLoading(false);

      startPolling(data.issueId);
    } catch (err) {
      setLoading(false);
      let msg = err.response?.data?.message || err.response?.data?.error || 'Submission failed. Please try again.';
      if (err.response?.data?.details) msg += ` (${err.response.data.details})`;
      setError(msg);
    }
  };

  // ── Reset after result ─────────────────────────────────────────────────────
  const handleReset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setResult(null);
    setAnalysisFailed(null);
    setError('');
    setAnalyzing(false);
  };

  // ── AI Analyzing screen ────────────────────────────────────────────────────
  if (analyzing) {
    const stageIdx = Math.min(Math.floor(Date.now() / 2000) % AI_STAGES.length, AI_STAGES.length - 1);
    return (
      <div className="max-w-lg mx-auto mt-16 p-8 bg-white rounded-2xl shadow-lg text-center">
        <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800 mb-2">AI is analyzing your report…</h2>
        <p className="text-slate-500 text-sm mb-6">Our system is verifying your image and estimating the response needed. This usually takes under a minute.</p>

        <div className="bg-slate-50 rounded-xl p-4 text-left mb-6 space-y-3">
          {AI_STAGES.map((stage, i) => (
            <div key={stage} className="flex items-center gap-3">
              <span className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                i < stageIdx ? 'bg-green-100 text-green-600' :
                i === stageIdx ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-300'
              }`}>
                {i < stageIdx ? <CheckCircle2 className="w-3.5 h-3.5" /> : <span className="text-[10px] font-bold">{i + 1}</span>}
              </span>
              <span className={`text-sm ${i === stageIdx ? 'font-medium text-slate-800' : i < stageIdx ? 'text-slate-400' : 'text-slate-300'}`}>
                {stage}
              </span>
            </div>
          ))}
        </div>

        {preview && (
          <img src={preview} alt="Submitted issue" className="w-24 h-24 object-cover rounded-lg mx-auto mb-6 border border-slate-200" />
        )}

        <div className="flex items-center gap-2 text-xs text-slate-400 justify-center mb-4">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Vision + LLM classification running in background — you can close this page.</span>
        </div>
      </div>
    );
  }

  // ── Success screen (new unique issue) ─────────────────────────────────────
  if (result && !result.duplicate) {
    return (
      <div className="max-w-lg mx-auto mt-16 p-8 bg-white rounded-2xl shadow-lg text-center">
        <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Issue Reported!</h2>
        <p className="text-slate-500 mb-4">{result.message}</p>
        <div className="bg-slate-50 rounded-xl p-4 text-left mb-6 space-y-2">
          <p className="text-sm"><span className="font-semibold text-slate-600">Description:</span> {result.issue?.description}</p>
          <p className="text-sm"><span className="font-semibold text-slate-600">Category:</span> {result.issue?.category || 'Other'}</p>
          <p className="text-sm"><span className="font-semibold text-slate-600">Priority:</span> {result.issue?.priority}</p>
          <p className="text-sm"><span className="font-semibold text-slate-600">Status:</span> {result.issue?.status}</p>
          {result.issue?.latitude && result.issue?.longitude && (
            <p className="text-sm">
              <span className="font-semibold text-slate-600">Location:</span>{' '}
              <LocationName lat={result.issue.latitude} lng={result.issue.longitude} prefix="" className="inline" />
            </p>
          )}
          <p className="text-sm">
            <span className="font-semibold text-slate-600">Times Reported:</span>{' '}
            <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 text-xs font-semibold px-2 py-0.5 rounded-md border border-slate-200">
              {result.issue?.reportCount ?? 1} submissions
            </span>
          </p>
        </div>
        <button
          onClick={handleReset}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition"
        >
          Report Another Issue
        </button>
      </div>
    );
  }

  // ── Duplicate detected screen ──────────────────────────────────────────────
  if (result && result.duplicate) {
    const count = result.reportCount ?? 2;
    const original = result.originalIssue;
    return (
      <div className="max-w-lg mx-auto mt-16 p-8 bg-white rounded-2xl shadow-lg text-center">
        <div className="w-16 h-16 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-amber-100">
          <AlertTriangle className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Already Reported!</h2>
        <p className="text-slate-500 mb-1">{result.message}</p>
        <p className="text-slate-400 text-sm mb-5">Your report has been counted — this issue is now marked as reported by multiple people.</p>

        <div className="flex items-center justify-center gap-2 mb-5">
          <span className="inline-flex items-center gap-2 bg-slate-50 text-slate-700 text-sm font-semibold px-4 py-2 rounded-md border border-slate-200 shadow-sm">
            Reported <span className="text-lg">{count}</span> time{count !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Original issue info */}
        {original && (
          <div className="bg-slate-50 rounded-xl p-4 text-left mb-6 space-y-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Original Issue</p>
            <p className="text-sm"><span className="font-semibold text-slate-600">Description:</span> {original.description}</p>
            <p className="text-sm"><span className="font-semibold text-slate-600">Priority:</span> {original.priority}</p>
            <p className="text-sm"><span className="font-semibold text-slate-600">Status:</span> {original.status}</p>
          </div>
        )}

        <button
          onClick={handleReset}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition"
        >
          Report Another Issue
        </button>
      </div>
    );
  }

  // ── Analysis failed / timeout screen ───────────────────────────────────────
  if (analysisFailed) {
    return (
      <div className="max-w-lg mx-auto mt-16 p-8 bg-white rounded-2xl shadow-lg text-center">
        <div className="w-16 h-16 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4 border border-amber-100">
          <AlertTriangle className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Report Received</h2>
        <p className="text-slate-500 mb-6">{analysisFailed}</p>
        <button
          onClick={handleReset}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition"
        >
          Report Another Issue
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-2">Report a Civic Issue</h1>
        <p className="text-slate-500 text-sm max-w-md mx-auto">Upload a clear photo and we'll handle the rest, from categorization to tracking.</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">

        {/* ── Image Upload Zone ── */}
        <div className="p-6 border-b border-slate-100">
          <h2 className="flex items-center gap-2 font-semibold text-slate-800 mb-4 tracking-tight">
            <Camera className="w-5 h-5 text-slate-400" />
            Issue Photograph
          </h2>

          {!preview ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                isDragging ? 'border-blue-400 bg-blue-50' : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50'
              }`}
            >
              <Camera className="w-10 h-10 mx-auto text-slate-300 mb-3 group-hover:text-blue-500 transition-colors" />
              <p className="font-medium text-slate-700">Drag & drop your image here</p>
              <p className="text-sm text-slate-500 mt-1">or click to browse from device</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileInput}
                className="hidden"
              />
            </div>
          ) : (
            <div className="relative">
              <img
                src={preview}
                alt="Preview"
                className="w-full h-64 object-cover rounded-xl border border-slate-200"
              />
              <button
                type="button"
                onClick={clearImage}
                className="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm shadow transition"
              >
                <X className="w-4 h-4" />
              </button>
              <p className="text-xs text-slate-400 mt-2 text-center">{image?.name}</p>
            </div>
          )}
        </div>

        {/* ── Location ── */}
        <div className="p-6 border-b border-slate-100">
          <h2 className="flex items-center gap-2 font-semibold text-slate-800 mb-1 tracking-tight">
            <Navigation className="w-5 h-5 text-blue-500" />
            Live GPS Location
          </h2>
          <p className="text-xs text-slate-400 mb-4">Automatically detected from your device — no address entry needed.</p>

          {locationLoading ? (
            <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-xl p-4">
              <Loader2 className="w-5 h-5 text-blue-500 animate-spin flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-blue-700">Acquiring GPS signal…</p>
                <p className="text-xs text-blue-400 mt-0.5">Please allow location access if prompted.</p>
              </div>
            </div>
          ) : location ? (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-2.5 w-2.5 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                  </span>
                  <p className="text-sm font-semibold text-green-700">GPS Lock Acquired ✓</p>
                </div>
                <button
                  type="button"
                  onClick={captureLocation}
                  className="text-xs text-green-600 hover:text-blue-600 font-medium transition flex items-center gap-1"
                >
                  <Navigation className="w-3 h-3" /> Refresh
                </button>
              </div>

              {/* Human-readable place name — prominent */}
              <div className="bg-white rounded-lg px-3 py-2.5 border border-green-100">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Detected Location</p>
                <LocationName
                  lat={location.latitude}
                  lng={location.longitude}
                  prefix=""
                  className="text-sm font-medium text-slate-800 block"
                />
              </div>

              {/* Raw coords — small technical detail */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-green-600 font-mono">{location.latitude.toFixed(5)}°, {location.longitude.toFixed(5)}°</span>
                {location.accuracy && (
                  <span className="text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    ±{location.accuracy} m
                  </span>
                )}
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={captureLocation}
              className="w-full border-2 border-dashed border-slate-300 hover:border-blue-400 rounded-xl p-5 text-center transition hover:bg-blue-50 group"
            >
              <Navigation className="w-8 h-8 mx-auto text-slate-300 mb-2 group-hover:text-blue-500 transition-colors" />
              <p className="font-medium text-slate-700">Tap to get your GPS coordinates</p>
              <p className="text-xs text-slate-500 mt-1">We need location access to direct field teams precisely</p>
            </button>
          )}
          {locationError && (
            <div className="mt-3 flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <p>{locationError}</p>
                <button onClick={captureLocation} className="text-xs font-semibold underline mt-1 hover:text-red-700">Try again</button>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-slate-50 border-b border-slate-100">
          <p className="text-xs text-slate-500 leading-relaxed">
            By submitting, our automated review system will assess the issue severity and dispatch the details to the appropriate local authority.
          </p>
        </div>

        {/* ── Submit ── */}
        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 rounded-lg text-sm bg-red-50 text-red-700 border border-red-100 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !image || !location}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Spinner size="sm" />
                <span>Processing Upload...</span>
              </>
            ) : (
              <>
                <Send className="w-5 h-5 mr-1" />
                Submit Report
              </>
            )}
          </button>

          {(!image || !location) && (
            <p className="text-xs text-slate-400 text-center mt-2">
              {!image && !location ? 'Add an image and location to continue' :
               !image ? 'Add an image to continue' : 'Capture location to continue'}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
