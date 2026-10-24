using System;

namespace Wbms.Api47.Infrastructure;

/// <summary>A broken business rule. The API returns it as 400 with { error: message }.</summary>
public class WorkflowException : Exception
{
    public WorkflowException(string message) : base(message) { }
}
